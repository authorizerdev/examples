// The orders service is internal: it accepts ONLY machine tokens
// (login_method=service_account) carrying orders:* scopes. When an order is
// placed it charges the billing service using its OWN machine identity,
// which is allowed exactly one scope: billing:charge.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/authorizerdev/examples/with-microservices-go/internal/authx"
)

type order struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Item        string `json:"item"`
	AmountCents int64  `json:"amount_cents"`
	ChargeID    string `json:"charge_id"`
	CreatedAt   string `json:"created_at"`
}

func main() {
	logger := authx.NewLogger("orders")

	authorizerURL := authx.Getenv("AUTHORIZER_URL", "http://localhost:8080")
	audience := authx.MustGetenv(logger, "AUTHORIZER_CLIENT_ID")
	clientID := authx.MustGetenv(logger, "ORDERS_CLIENT_ID")
	clientSecret := authx.MustGetenv(logger, "ORDERS_CLIENT_SECRET")
	billingURL := authx.Getenv("BILLING_URL", "http://localhost:4102")
	port := authx.Getenv("ORDERS_PORT", "4101")

	verifier := authx.NewVerifier(authorizerURL, audience)
	tokens, err := authx.NewTokenSource(authorizerURL, clientID, clientSecret, "billing:charge")
	if err != nil {
		logger.Error("token source", "error", err)
		os.Exit(1)
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}

	// ponytail: in-memory store; a real service would use a database.
	var mu sync.Mutex
	var orders []order
	var seq int

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		authx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.Handle("GET /orders", verifier.Require(authx.Service, "orders:read")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			authx.WriteJSON(w, http.StatusOK, map[string]any{"orders": orders})
		})))

	mux.Handle("POST /orders", verifier.Require(authx.Service, "orders:write")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Item        string `json:"item"`
				AmountCents int64  `json:"amount_cents"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil || in.Item == "" || in.AmountCents <= 0 {
				authx.WriteJSON(w, http.StatusBadRequest, map[string]string{
					"error": "invalid_request", "error_description": "item and positive amount_cents required",
				})
				return
			}

			// Cross-service call: charge billing with our machine token.
			token, err := tokens.Token()
			if err != nil {
				logger.Error("mint machine token", "error", err)
				authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream_auth_failed"})
				return
			}
			chargeBody, _ := json.Marshal(map[string]any{"amount_cents": in.AmountCents})
			req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, billingURL+"/charge", bytes.NewReader(chargeBody))
			if err != nil {
				authx.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
				return
			}
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			authx.PropagateRequestID(r, req)

			res, err := httpClient.Do(req)
			if err != nil {
				logger.Error("call billing", "error", err)
				authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "billing_unavailable"})
				return
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
				logger.Error("billing charge rejected", "status", res.StatusCode, "body", string(body))
				authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "charge_failed"})
				return
			}
			var charge struct {
				ChargeID string `json:"charge_id"`
			}
			if err := json.NewDecoder(res.Body).Decode(&charge); err != nil {
				authx.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "charge_failed"})
				return
			}

			mu.Lock()
			seq++
			o := order{
				ID:          fmt.Sprintf("ord_%d", seq),
				UserID:      r.Header.Get("X-User-ID"),
				Item:        in.Item,
				AmountCents: in.AmountCents,
				ChargeID:    charge.ChargeID,
				CreatedAt:   time.Now().UTC().Format(time.RFC3339),
			}
			orders = append(orders, o)
			mu.Unlock()

			logger.Info("order created", "order_id", o.ID, "user_id", o.UserID, "charge_id", o.ChargeID, "request_id", authx.RequestID(r))
			authx.WriteJSON(w, http.StatusCreated, o)
		})))

	authx.Serve(logger, ":"+port, authx.LogRequests(logger, mux))
}
