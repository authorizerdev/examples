package authx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// ScopeList unmarshals the OAuth2 `scope` claim. Authorizer emits it as a
// JSON ARRAY on machine (client_credentials) tokens; other issuers commonly
// emit a space-delimited string — accept both.
type ScopeList []string

func (s *ScopeList) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		*s = strings.Fields(str)
		return nil
	}
	var arr []string
	if err := json.Unmarshal(b, &arr); err != nil {
		return err
	}
	*s = arr
	return nil
}

func (s ScopeList) Has(scope string) bool {
	for _, v := range s {
		if v == scope {
			return true
		}
	}
	return false
}

// Claims is the subset of Authorizer access-token claims the services act on.
type Claims struct {
	jwt.RegisteredClaims
	Scope       ScopeList `json:"scope"`
	LoginMethod string    `json:"login_method"`
	TokenType   string    `json:"token_type"`
	Roles       []string  `json:"roles"`
}

// IsServiceAccount reports whether the token was minted via the
// client_credentials grant for a service account (machine identity).
func (c *Claims) IsServiceAccount() bool { return c.LoginMethod == "service_account" }

type ctxKey struct{}

// ClaimsFrom returns the verified claims attached by Verifier middleware.
func ClaimsFrom(ctx context.Context) *Claims {
	c, _ := ctx.Value(ctxKey{}).(*Claims)
	return c
}

// PrincipalKind selects which class of token a route accepts.
type PrincipalKind int

const (
	// User accepts only human tokens (login_method != service_account).
	User PrincipalKind = iota
	// Service accepts only machine tokens (login_method == service_account).
	Service
)

// Verifier validates Authorizer-issued RS256 access tokens against the
// deployment's JWKS, issuer and audience.
type Verifier struct {
	jwks     *JWKS
	issuer   string
	audience string
}

// NewVerifier builds a Verifier for one Authorizer deployment. issuer is the
// Authorizer base URL (the `iss` claim); audience is the deployment client ID
// (the `aud` claim on every token it signs, machine or human).
func NewVerifier(authorizerURL, audience string) *Verifier {
	return &Verifier{
		jwks:     NewJWKS(authorizerURL),
		issuer:   authorizerURL,
		audience: audience,
	}
}

func (v *Verifier) parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		return v.jwks.Key(kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != "access_token" {
		return nil, fmt.Errorf("token_type %q is not an access token", claims.TokenType)
	}
	return claims, nil
}

// Require returns middleware enforcing a valid bearer token of the given
// principal kind carrying every scope in scopes. On success the verified
// Claims are attached to the request context.
func (v *Verifier) Require(kind PrincipalKind, scopes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				unauthorized(w, "missing bearer token")
				return
			}
			claims, err := v.parse(raw)
			if err != nil {
				unauthorized(w, "invalid token")
				return
			}
			if kind == Service && !claims.IsServiceAccount() {
				forbidden(w, "insufficient_scope", "service account token required")
				return
			}
			if kind == User && claims.IsServiceAccount() {
				forbidden(w, "invalid_token_use", "user token required, got service account token")
				return
			}
			for _, s := range scopes {
				if !claims.Scope.Has(s) {
					forbidden(w, "insufficient_scope", "token is missing required scope "+s)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, claims)))
		})
	}
}

func bearerToken(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(auth) <= len(prefix) || !strings.EqualFold(auth[:len(prefix)], prefix) {
		return "", false
	}
	return auth[len(prefix):], true
}

func unauthorized(w http.ResponseWriter, desc string) {
	w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
	WriteJSON(w, http.StatusUnauthorized, map[string]string{
		"error":             "invalid_token",
		"error_description": desc,
	})
}

func forbidden(w http.ResponseWriter, code, desc string) {
	w.Header().Set("WWW-Authenticate", fmt.Sprintf("Bearer error=%q", code))
	WriteJSON(w, http.StatusForbidden, map[string]string{
		"error":             code,
		"error_description": desc,
	})
}

// WriteJSON writes v as a JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
