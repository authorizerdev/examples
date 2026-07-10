package authx

import (
	"fmt"
	"sync"
	"time"

	authorizer "github.com/authorizerdev/authorizer-go"
)

// refreshMargin is how long before expiry a cached token is considered stale.
// Refreshing early means callers never hold a token that dies mid-request.
const refreshMargin = 60 * time.Second

// TokenSource mints and caches a machine (client_credentials) access token
// for one service account. Every outbound service-to-service call asks the
// TokenSource for a token; it returns the cached one until shortly before
// expiry, then mints a fresh one. This is the production pattern — minting a
// token per request would put the auth server on every request's hot path.
type TokenSource struct {
	client       *authorizer.AuthorizerClient
	clientSecret string
	scope        string

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

// NewTokenSource builds a TokenSource for a service-account client. scope is
// the space-delimited set of scopes to request; it must be within the
// client's allowed_scopes ceiling or the auth server returns invalid_scope.
func NewTokenSource(authorizerURL, clientID, clientSecret, scope string) (*TokenSource, error) {
	client, err := authorizer.NewAuthorizerClient(clientID, authorizerURL, "", nil)
	if err != nil {
		return nil, fmt.Errorf("authorizer client: %w", err)
	}
	return &TokenSource{
		client:       client,
		clientSecret: clientSecret,
		scope:        scope,
	}, nil
}

// Token returns a valid machine access token, minting a new one only when the
// cached token is absent or within refreshMargin of expiry. Safe for
// concurrent use; concurrent callers during a refresh serialize on the mutex
// so the auth server sees a single mint.
func (ts *TokenSource) Token() (string, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.token != "" && time.Now().Before(ts.expiresAt.Add(-refreshMargin)) {
		return ts.token, nil
	}

	res, err := ts.client.GetToken(&authorizer.GetTokenRequest{
		GrantType:    authorizer.NewStringRef(authorizer.GrantTypeClientCredentials),
		ClientSecret: authorizer.NewStringRef(ts.clientSecret),
		Scope:        authorizer.NewStringRef(ts.scope),
	})
	if err != nil {
		return "", fmt.Errorf("client_credentials grant: %w", err)
	}
	ts.token = res.AccessToken
	ts.expiresAt = time.Now().Add(time.Duration(res.ExpiresIn) * time.Second)
	return ts.token, nil
}
