// Authorizer Go SDK example: signup / login / profile over the GraphQL
// protocol, plus the admin client listing users.
//
// Run against a local Authorizer (defaults match `make dev` in the server repo):
//
//	AUTHORIZER_URL=http://localhost:8080 \
//	CLIENT_ID=kbyuFDidLLm280LIwVFiazOqjO3ty8KH \
//	ADMIN_SECRET=admin \
//	go run .
package main

import (
	"fmt"
	"log"
	"os"
	"time"

	authorizer "github.com/authorizerdev/authorizer-go/v2"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	url := env("AUTHORIZER_URL", "http://localhost:8080")
	clientID := env("CLIENT_ID", "kbyuFDidLLm280LIwVFiazOqjO3ty8KH")
	adminSecret := env("ADMIN_SECRET", "admin")

	// ---- Public client (GraphQL protocol; also available: rest, grpc) ----
	client, err := authorizer.NewAuthorizerClient(
		clientID, url, "", nil,
		authorizer.WithProtocol(authorizer.ProtocolGraphQL),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Signup with a fresh email so the example is re-runnable.
	email := fmt.Sprintf("go-demo-%d@example.com", time.Now().Unix())
	password := "Go-demo-pass-1!"
	if _, err := client.SignUp(&authorizer.SignUpRequest{
		Email:           &email,
		Password:        password,
		ConfirmPassword: password,
	}); err != nil {
		log.Fatal("signup: ", err)
	}
	fmt.Println("signed up:", email)

	// Login (redundant right after signup, shown for completeness).
	login, err := client.Login(&authorizer.LoginRequest{
		Email:    &email,
		Password: password,
	})
	if err != nil {
		log.Fatal("login: ", err)
	}
	fmt.Println("logged in, token expires in:", *login.ExpiresIn, "seconds")

	// Profile: authenticated with the user's own bearer token.
	profile, err := client.GetProfile(map[string]string{
		"Authorization": "Bearer " + *login.AccessToken,
	})
	if err != nil {
		log.Fatal("profile: ", err)
	}
	fmt.Println("profile:", profile.Email, "id:", profile.ID)

	// ---- Admin client (authenticates with x-authorizer-admin-secret) ----
	admin, err := authorizer.NewAuthorizerAdminClient(url, adminSecret)
	if err != nil {
		log.Fatal(err)
	}
	users, err := admin.Users(nil) // nil = default pagination
	if err != nil {
		log.Fatal("admin users: ", err)
	}
	fmt.Printf("admin: %d user(s) on this instance:\n", len(users.GetUsers()))
	for _, u := range users.GetUsers() {
		fmt.Println("  -", u.GetEmail())
	}
}
