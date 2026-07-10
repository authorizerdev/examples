package authx

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// JWKS fetches and caches RSA public keys from an Authorizer JWKS endpoint
// (<authorizer-url>/.well-known/jwks.json). Keys are cached in memory; an
// unknown kid triggers a refetch, rate-limited so a flood of bad tokens
// cannot hammer the auth server.
type JWKS struct {
	url    string
	client *http.Client

	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	lastFetch time.Time
}

const jwksRefetchMinInterval = time.Minute

func NewJWKS(authorizerURL string) *JWKS {
	return &JWKS{
		url:    authorizerURL + "/.well-known/jwks.json",
		client: &http.Client{Timeout: 10 * time.Second},
		keys:   map[string]*rsa.PublicKey{},
	}
}

// Key returns the RSA public key for kid, refetching the JWKS on a cache miss.
// Authorizer signs tokens WITHOUT a kid header; when kid is empty and the
// JWKS holds exactly one key, that key is used.
func (j *JWKS) Key(kid string) (*rsa.PublicKey, error) {
	j.mu.RLock()
	key, err := j.lookupLocked(kid)
	j.mu.RUnlock()
	if err == nil {
		return key, nil
	}

	j.mu.Lock()
	defer j.mu.Unlock()
	// Re-check under the write lock; another goroutine may have refreshed.
	if key, err := j.lookupLocked(kid); err == nil {
		return key, nil
	}
	if time.Since(j.lastFetch) < jwksRefetchMinInterval && !j.lastFetch.IsZero() {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	if err := j.fetchLocked(); err != nil {
		return nil, err
	}
	return j.lookupLocked(kid)
}

func (j *JWKS) lookupLocked(kid string) (*rsa.PublicKey, error) {
	if key, ok := j.keys[kid]; ok {
		return key, nil
	}
	if kid == "" && len(j.keys) == 1 {
		for _, key := range j.keys {
			return key, nil
		}
	}
	return nil, fmt.Errorf("unknown key id %q", kid)
}

func (j *JWKS) fetchLocked() error {
	j.lastFetch = time.Now()
	res, err := j.client.Get(j.url)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch jwks: status %d", res.StatusCode)
	}

	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return fmt.Errorf("decode jwks modulus: %w", err)
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return fmt.Errorf("decode jwks exponent: %w", err)
		}
		keys[k.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(nBytes),
			E: int(new(big.Int).SetBytes(eBytes).Int64()),
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("jwks at %s contains no RSA keys", j.url)
	}
	j.keys = keys
	return nil
}
