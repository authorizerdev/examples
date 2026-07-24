// Secretless worker: authenticates to Authorizer with its projected Kubernetes
// ServiceAccount token as an RFC 7523 client_assertion (jwt-bearer), then uses
// the returned access token against a sample protected endpoint.
//
// No client_secret anywhere: the kubelet mints and rotates the credential, and
// Authorizer verifies it against the cluster's JWKS via a registered trusted
// issuer (see ../setup.md).
package main

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	authorizer "github.com/authorizerdev/authorizer-go/v2"
	"github.com/golang-jwt/jwt/v4"
)

const (
	// RFC 7523 client assertion type URN — K8s SA tokens use the generic
	// jwt-bearer profile (constants.ClientAssertionTypeJWTBearer server-side).
	assertionTypeJWTBearer = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	authorizerURL := env("AUTHORIZER_URL", "http://authorizer.authorizer-demo.svc:8080")
	tokenFile := env("TOKEN_FILE", "/var/run/secrets/tokens/authorizer-token")
	scope := os.Getenv("SCOPE") // empty = server grants the full allowed_scopes set
	sampleAddr := env("SAMPLE_ADDR", ":8000")
	interval, err := time.ParseDuration(env("INTERVAL", "5m"))
	if err != nil {
		log.Fatalf("bad INTERVAL: %v", err)
	}

	// CLIENT_ID is required by the SDK constructor but IGNORED by the server on
	// the client_assertion path — the client is derived from the trusted issuer
	// the assertion's iss resolves to. Any non-empty value works.
	client, err := authorizer.NewAuthorizerClient(env("CLIENT_ID", "workload"), authorizerURL, "", nil)
	if err != nil {
		log.Fatalf("authorizer client: %v", err)
	}

	// Sample protected endpoint: verifies the Bearer token offline against
	// Authorizer's JWKS. In a real system this is your own microservice.
	go serveSampleAPI(sampleAddr, authorizerURL)

	for {
		if err := run(client, tokenFile, scope, sampleAddr); err != nil {
			log.Printf("ERROR: %v", err)
		}
		time.Sleep(interval)
	}
}

// run performs one full round: read the (kubelet-rotated) projected token,
// exchange it for an Authorizer access token, call the sample endpoint.
//
// Assertions are single-use server-side (replay protection). The kubelet
// refreshes the projected token well before expiry, but two exchanges of the
// same file content would be rejected — which is why production workloads on a
// tight loop should mint per-request tokens via the TokenRequest API. At a 5m
// interval the kubelet-refreshed file is fine.
func run(client *authorizer.AuthorizerClient, tokenFile, scope, sampleAddr string) error {
	saToken, err := os.ReadFile(tokenFile)
	if err != nil {
		return fmt.Errorf("reading projected token: %w", err)
	}
	assertion := strings.TrimSpace(string(saToken))

	req := &authorizer.GetTokenRequest{
		GrantType:           authorizer.NewStringRef(authorizer.GrantTypeClientCredentials),
		ClientAssertion:     &assertion,
		ClientAssertionType: authorizer.NewStringRef(assertionTypeJWTBearer),
	}
	if scope != "" {
		req.Scope = &scope
	}
	tokenRes, err := client.GetToken(req)
	if err != nil {
		return fmt.Errorf("token exchange failed: %w", err)
	}
	log.Printf("got access token (expires_in=%ds scope=%q)", tokenRes.ExpiresIn, tokenRes.Scope)

	// Use the access token against the sample protected endpoint.
	httpReq, err := http.NewRequest(http.MethodGet, "http://localhost"+sampleAddr+"/hello", nil)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Authorization", "Bearer "+tokenRes.AccessToken)
	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("sample endpoint call: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	log.Printf("sample endpoint %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("sample endpoint rejected the token")
	}
	return nil
}

// --- sample protected endpoint -----------------------------------------------

// serveSampleAPI runs a minimal resource server that accepts requests only with
// a valid Authorizer-signed Bearer token (RS256, verified against
// {authorizerURL}/.well-known/jwks.json).
func serveSampleAPI(addr, authorizerURL string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if raw == "" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		claims := jwt.MapClaims{}
		_, err := jwt.ParseWithClaims(raw, claims, jwksKeyfunc(authorizerURL),
			jwt.WithValidMethods([]string{"RS256"}))
		if err != nil {
			http.Error(w, "invalid token: "+err.Error(), http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": "hello, authenticated workload",
			"sub":     claims["sub"],
			"scope":   claims["scope"],
		})
	})
	log.Printf("sample protected endpoint on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// jwksKeyfunc fetches Authorizer's JWKS and resolves the token's kid to an RSA
// public key. ponytail: fetched per request, no cache — fine for a demo loop.
func jwksKeyfunc(authorizerURL string) jwt.Keyfunc {
	return func(t *jwt.Token) (any, error) {
		res, err := http.Get(strings.TrimSuffix(authorizerURL, "/") + "/.well-known/jwks.json")
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		var set struct {
			Keys []struct {
				Kid string `json:"kid"`
				N   string `json:"n"`
				E   string `json:"e"`
			} `json:"keys"`
		}
		if err := json.NewDecoder(res.Body).Decode(&set); err != nil {
			return nil, err
		}
		kid, _ := t.Header["kid"].(string)
		for _, k := range set.Keys {
			if kid != "" && k.Kid != kid {
				continue
			}
			nb, err := base64.RawURLEncoding.DecodeString(k.N)
			if err != nil {
				return nil, err
			}
			eb, err := base64.RawURLEncoding.DecodeString(k.E)
			if err != nil {
				return nil, err
			}
			return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: int(new(big.Int).SetBytes(eb).Int64())}, nil
		}
		return nil, fmt.Errorf("no JWKS key for kid %q", kid)
	}
}
