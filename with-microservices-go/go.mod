module github.com/authorizerdev/examples/with-microservices-go

go 1.25.5

// Local main of the Go SDK: it carries the working client_credentials support
// in GetToken (GrantTypeClientCredentials). Drop this replace once the next
// authorizer-go release ships.
replace github.com/authorizerdev/authorizer-go => ../../authorizer-go

require (
	github.com/authorizerdev/authorizer-go v0.0.0-00010101000000-000000000000
	github.com/golang-jwt/jwt/v5 v5.2.2
)

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20260415201107-50325440f8f2.1 // indirect
	golang.org/x/net v0.51.0 // indirect
	golang.org/x/sys v0.42.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260523011958-0a33c5d7ca68 // indirect
	google.golang.org/grpc v1.81.1 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
