// The gateway is the ONLY public-facing service. It authenticates end-user
// JWTs issued by Authorizer, then calls internal services using its OWN
// machine identity (client_credentials) — user tokens never cross the trust
// boundary into the internal network.
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/authorizerdev/examples/with-microservices-go/internal/authx"
)

func main() {
	logger := authx.NewLogger("gateway")

	authorizerURL := authx.Getenv("AUTHORIZER_URL", "http://localhost:8080")
	audience := authx.MustGetenv(logger, "AUTHORIZER_CLIENT_ID")
	clientID := authx.MustGetenv(logger, "GATEWAY_CLIENT_ID")
	clientSecret := authx.MustGetenv(logger, "GATEWAY_CLIENT_SECRET")
	ordersURL := authx.Getenv("ORDERS_URL", "http://localhost:4101")
	port := authx.Getenv("GATEWAY_PORT", "4100")

	verifier := authx.NewVerifier(authorizerURL, audience)

	// One long-lived token source for all outbound calls to orders. Tokens
	// are cached and refreshed before expiry — never minted per request.
	tokens, err := authx.NewTokenSource(authorizerURL, clientID, clientSecret, "orders:read orders:write")
	if err != nil {
		logger.Error("token source", "error", err)
		os.Exit(1)
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}

	proxyToOrders := func(w http.ResponseWriter, r *http.Request, method, path string, body io.Reader) {
		token, err := tokens.Token()
		if err != nil {
			logger.Error("mint machine token", "error", err)
			authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_auth_failed"})
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), method, ordersURL+path, body)
		if err != nil {
			authx.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		// The verified end-user identity travels as metadata, not as a token.
		req.Header.Set("X-User-ID", authx.ClaimsFrom(r.Context()).Subject)
		authx.PropagateRequestID(r, req)

		res, err := httpClient.Do(req)
		if err != nil {
			logger.Error("call orders", "error", err)
			authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "orders_unavailable"})
			return
		}
		defer res.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(res.StatusCode)
		_, _ = io.Copy(w, res.Body)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		authx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	requireUser := verifier.Require(authx.User)

	// GET /api/me — show the caller who they are (verified claims).
	mux.Handle("GET /api/me", requireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := authx.ClaimsFrom(r.Context())
		authx.WriteJSON(w, http.StatusOK, map[string]any{
			"sub": c.Subject, "roles": c.Roles, "login_method": c.LoginMethod,
		})
	})))

	// POST /api/orders — user places an order; gateway forwards to the
	// orders service under its machine identity.
	mux.Handle("POST /api/orders", requireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil || !json.Valid(body) {
			authx.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		proxyToOrders(w, r, http.MethodPost, "/orders", bytes.NewReader(body))
	})))

	// GET /api/orders — list orders via the orders service.
	mux.Handle("GET /api/orders", requireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyToOrders(w, r, http.MethodGet, "/orders", nil)
	})))

	authx.Serve(logger, ":"+port, authx.LogRequests(logger, mux))
}
