// SPIFFE workload: fetches a JWT-SVID from the SPIRE agent's Workload API and
// exchanges it at Authorizer's /oauth/token as the client credential, using the
// jwt-spiffe client_assertion type (draft-ietf-oauth-spiffe-client-auth —
// Authorizer ships this as a PREVIEW; the URN is not IANA-registered).
//
// Secretless: the workload's identity is attested by SPIRE (no secret is ever
// distributed), and Authorizer pins the SVID's SPIFFE ID (`sub`) against the
// trusted issuer's allowed_subjects. Note iss ≠ sub on this path — `iss` is the
// SPIRE server, `sub` is the workload's spiffe:// ID; that is expected and is
// exactly why jwt-spiffe is a distinct assertion type.
package main

import (
	"context"
	"log"
	"os"
	"time"

	authorizer "github.com/authorizerdev/authorizer-go"
	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

// Client assertion type URN for SPIFFE JWT-SVIDs
// (constants.ClientAssertionTypeJWTSPIFFE server-side).
const assertionTypeJWTSPIFFE = "urn:ietf:params:oauth:client-assertion-type:jwt-spiffe"

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	authorizerURL := env("AUTHORIZER_URL", "http://authorizer:8080")
	socket := env("SPIFFE_ENDPOINT_SOCKET", "unix:///spiffe-workload-api/spire-agent.sock")
	// AUDIENCE must equal the trusted issuer's expected_aud.
	audience := env("AUDIENCE", "http://authorizer:8080")
	scope := os.Getenv("SCOPE") // empty = server grants the full allowed_scopes set
	interval, err := time.ParseDuration(env("INTERVAL", "5m"))
	if err != nil {
		log.Fatalf("bad INTERVAL: %v", err)
	}

	// CLIENT_ID is required by the SDK constructor but IGNORED by the server on
	// the client_assertion path — the client is derived from the trusted issuer
	// the SVID's iss resolves to. Any non-empty value works.
	client, err := authorizer.NewAuthorizerClient(env("CLIENT_ID", "workload"), authorizerURL, "", nil)
	if err != nil {
		log.Fatalf("authorizer client: %v", err)
	}

	for {
		if err := run(client, socket, audience, scope); err != nil {
			log.Printf("ERROR: %v", err)
		}
		time.Sleep(interval)
	}
}

// run fetches a FRESH JWT-SVID and exchanges it. Fresh per call on purpose:
// Authorizer treats assertions as single-use (replay protection), so a cached
// SVID must never be presented twice.
func run(client *authorizer.AuthorizerClient, socket, audience, scope string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	svid, err := workloadapi.FetchJWTSVID(ctx,
		jwtsvid.Params{Audience: audience},
		workloadapi.WithAddr(socket),
	)
	if err != nil {
		return err
	}
	log.Printf("fetched JWT-SVID for %s", svid.ID)

	assertion := svid.Marshal()
	req := &authorizer.GetTokenRequest{
		GrantType:           authorizer.NewStringRef(authorizer.GrantTypeClientCredentials),
		ClientAssertion:     &assertion,
		ClientAssertionType: authorizer.NewStringRef(assertionTypeJWTSPIFFE),
	}
	if scope != "" {
		req.Scope = &scope
	}
	tokenRes, err := client.GetToken(req)
	if err != nil {
		return err
	}
	log.Printf("exchanged JWT-SVID for Authorizer access token (expires_in=%ds scope=%q)",
		tokenRes.ExpiresIn, tokenRes.Scope)
	return nil
}
