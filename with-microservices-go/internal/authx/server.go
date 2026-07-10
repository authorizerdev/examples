package authx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Getenv returns the environment variable or a default.
func Getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// MustGetenv returns the environment variable or exits with a clear message.
func MustGetenv(logger *slog.Logger, key string) string {
	v := os.Getenv(key)
	if v == "" {
		logger.Error("missing required environment variable (run setup.sh and `source .env`)", "var", key)
		os.Exit(1)
	}
	return v
}

// NewLogger returns a JSON slog logger tagged with the service name.
func NewLogger(service string) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", service)
}

const requestIDHeader = "X-Request-ID"

// RequestID returns the propagated request ID, generating one if absent.
func RequestID(r *http.Request) string {
	if id := r.Header.Get(requestIDHeader); id != "" {
		return id
	}
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// PropagateRequestID copies the inbound request ID onto an outbound request
// so one user action is traceable across all services.
func PropagateRequestID(inbound *http.Request, outbound *http.Request) {
	outbound.Header.Set(requestIDHeader, RequestID(inbound))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// LogRequests logs every request with method, path, status, duration and
// request ID, and echoes the request ID back to the caller.
func LogRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := RequestID(r)
		r.Header.Set(requestIDHeader, id)
		w.Header().Set(requestIDHeader, id)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", id,
		)
	})
}

// Serve runs the HTTP server until SIGINT/SIGTERM, then shuts down
// gracefully, draining in-flight requests for up to 10 seconds.
func Serve(logger *slog.Logger, addr string, handler http.Handler) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	logger.Info("listening", "addr", addr)

	select {
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown", "error", err)
		}
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server", "error", err)
			os.Exit(1)
		}
	}
}
