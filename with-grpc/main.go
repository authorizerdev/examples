// Example: talking to Authorizer over its gRPC API (the third transport
// besides GraphQL and REST).
//
// It demonstrates:
//  1. Public AuthorizerService — Signup, Login (no auth metadata needed)
//  2. Authenticated user call — Profile with `authorization: Bearer <token>`
//  3. AuthorizerAdminService — Users + CreateClient with
//     `x-authorizer-admin-secret` metadata
//
// Run the dev server first (from the authorizer repo): make dev
// Then: go run .
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	authorizerv1 "github.com/authorizerdev/examples/with-grpc/gen/authorizer/v1"
)

func main() {
	grpcAddr := flag.String("grpc", "127.0.0.1:9091", "Authorizer gRPC address (--grpc-port)")
	httpURL := flag.String("url", "http://localhost:8080", "Authorizer public base URL (used as x-authorizer-url; token issuer)")
	adminSecret := flag.String("admin-secret", "admin", "Admin secret (make dev uses 'admin')")
	flag.Parse()

	// Plaintext dial for local dev. In production use TLS:
	//   creds := credentials.NewTLS(&tls.Config{})
	//   grpc.NewClient(addr, grpc.WithTransportCredentials(creds))
	conn, err := grpc.NewClient(*grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	user := authorizerv1.NewAuthorizerServiceClient(conn)
	admin := authorizerv1.NewAuthorizerAdminServiceClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Pure-gRPC callers must tell the server its public base URL so tokens
	// are minted/validated with the right issuer. REST callers get this from
	// the HTTP Host header; gRPC callers set it as metadata on every call.
	baseCtx := metadata.AppendToOutgoingContext(ctx, "x-authorizer-url", *httpURL)

	// --- 1. Public: Signup (no auth metadata) ---------------------------
	email := fmt.Sprintf("grpc-demo-%d@example.com", time.Now().UnixNano())
	password := "Grpc-demo-pass-1!"
	signup, err := user.Signup(baseCtx, &authorizerv1.SignupRequest{
		Email:           email,
		Password:        password,
		ConfirmPassword: password,
	})
	if err != nil {
		log.Fatalf("signup: %v", err)
	}
	fmt.Printf("1. Signup      : %s (user id %s)\n", signup.Message, signup.User.GetId())

	// --- 2. Public: Login → access token --------------------------------
	login, err := user.Login(baseCtx, &authorizerv1.LoginRequest{
		Email:    email,
		Password: password,
	})
	if err != nil {
		log.Fatalf("login: %v", err)
	}
	fmt.Printf("2. Login       : got access token (expires in %ds)\n", login.ExpiresIn)

	// --- 3. Authenticated user call: Profile with bearer metadata -------
	authedCtx := metadata.AppendToOutgoingContext(baseCtx,
		"authorization", "Bearer "+login.AccessToken)
	profile, err := user.Profile(authedCtx, &authorizerv1.ProfileRequest{})
	if err != nil {
		log.Fatalf("profile: %v", err)
	}
	fmt.Printf("3. Profile     : %s (roles %v)\n", profile.GetEmail(), profile.GetRoles())

	// --- 4. Admin: list users with x-authorizer-admin-secret ------------
	adminCtx := metadata.AppendToOutgoingContext(baseCtx,
		"x-authorizer-admin-secret", *adminSecret)
	users, err := admin.Users(adminCtx, &authorizerv1.UsersRequest{})
	if err != nil {
		log.Fatalf("admin users: %v", err)
	}
	fmt.Printf("4. Admin Users : %d user(s) total\n", len(users.Users))

	// --- 5. Admin: create an OAuth client (service account) -------------
	client, err := admin.CreateClient(adminCtx, &authorizerv1.CreateClientRequest{
		Name:          fmt.Sprintf("grpc-demo-client-%d", time.Now().UnixNano()),
		AllowedScopes: []string{"openid", "profile"},
	})
	if err != nil {
		log.Fatalf("admin create client: %v", err)
	}
	fmt.Printf("5. CreateClient: client_id %s (secret returned once: %s...)\n",
		client.Client.GetClientId(), client.ClientSecret[:8])

	// --- 6. Same API over REST (grpc-gateway) ---------------------------
	// Every RPC above is also served as REST on the HTTP port. Equivalent
	// of step 3 with curl:
	fmt.Printf("\n6. REST equivalent of Profile (same handler via grpc-gateway):\n"+
		"   curl -H 'Authorization: Bearer <access_token>' %s/v1/profile\n", *httpURL)
}
