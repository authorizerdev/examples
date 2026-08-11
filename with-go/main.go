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
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
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

	// Since 2.4.0 MFA is ON by default, so a brand-new user is OFFERED an MFA
	// setup and the access token is WITHHELD until they either enrol a factor
	// or explicitly decline. Login therefore returns no token here — it
	// returns "Proceed to mfa setup" — and dereferencing the token straight
	// away panics.
	//
	// This example declines, which is what SkipMfaSetup is for: it records the
	// refusal and releases the withheld token. Fails if the instance runs with
	// --enforce-mfa, where declining is not permitted; a real app would drive
	// the TOTP/OTP setup screen instead.
	//
	// The call is identified by the `mfa_session` cookie the login response
	// set, plus the email. authorizer-go builds a fresh http.Client per call
	// with no cookie jar, so nothing captured that cookie — mfaSessionCookie
	// below re-runs the login over net/http to read it off the response, and
	// ExtraHeaders replays it on the SkipMfaSetup call. Drop both once the SDK
	// ships a cookie jar.
	if login.AccessToken == nil {
		fmt.Println("mfa setup offered:", refString(login.Message))
		cookie, err := mfaSessionCookie(url, clientID, email, password)
		if err != nil {
			log.Fatal("mfa session: ", err)
		}
		client.ExtraHeaders = map[string]string{"Cookie": cookie}
		login, err = client.SkipMfaSetup(&authorizer.SkipMfaSetupRequest{Email: &email})
		if err != nil {
			log.Fatal("skip mfa setup: ", err)
		}
		client.ExtraHeaders = nil
		fmt.Println("mfa setup declined, token issued")
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

// refString safely reads an optional string field.
func refString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// mfaSessionCookie logs in over plain net/http purely to read the
// `mfa_session` cookie off the response, and returns it as a Cookie header
// value. Two things make this necessary and neither is the example's doing:
// authorizer-go keeps no cookie jar, and the server marks the cookie Secure
// even over http (--app-cookie-secure defaults to true), so a jar would
// refuse to replay it against a local server anyway. Sending the header by
// hand sidesteps both.
func mfaSessionCookie(authorizerURL, clientID, email, password string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"query": `mutation ($p: LoginRequest!) { login(params: $p) { message } }`,
		"variables": map[string]any{
			"p": map[string]string{"email": email, "password": password},
		},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, authorizerURL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	// Authorizer's CSRF guard rejects state-changing requests with no Origin.
	req.Header.Set("Origin", authorizerURL)
	req.Header.Set("x-authorizer-client-id", clientID)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, res.Body)

	for _, c := range res.Cookies() {
		if c.Name == "mfa_session" {
			return c.Name + "=" + c.Value, nil
		}
	}
	return "", fmt.Errorf("no mfa_session cookie on the login response")
}
