// The billing service is the deepest internal service. It accepts ONLY
// machine tokens carrying the billing:charge scope — the gateway's machine
// token (orders:* scopes) is rejected here with 403 insufficient_scope.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/authorizerdev/examples/with-microservices-go/internal/authx"
)

func main() {
	logger := authx.NewLogger("billing")

	authorizerURL := authx.Getenv("AUTHORIZER_URL", "http://localhost:8080")
	audience := authx.MustGetenv(logger, "AUTHORIZER_CLIENT_ID")
	port := authx.Getenv("BILLING_PORT", "4102")

	verifier := authx.NewVerifier(authorizerURL, audience)

	var seq atomic.Int64

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		authx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.Handle("POST /charge", verifier.Require(authx.Service, "billing:charge")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				AmountCents int64 `json:"amount_cents"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil || in.AmountCents <= 0 {
				authx.WriteJSON(w, http.StatusBadRequest, map[string]string{
					"error": "invalid_request", "error_description": "positive amount_cents required",
				})
				return
			}
			caller := authx.ClaimsFrom(r.Context())
			chargeID := fmt.Sprintf("ch_%d", seq.Add(1))
			logger.Info("charge captured",
				"charge_id", chargeID,
				"amount_cents", in.AmountCents,
				"caller_service_account", caller.Subject,
				"request_id", authx.RequestID(r),
			)
			authx.WriteJSON(w, http.StatusOK, map[string]any{
				"charge_id":    chargeID,
				"status":       "succeeded",
				"amount_cents": in.AmountCents,
				"charged_at":   time.Now().UTC().Format(time.RFC3339),
			})
		})))

	authx.Serve(logger, ":"+port, authx.LogRequests(logger, mux))
}
