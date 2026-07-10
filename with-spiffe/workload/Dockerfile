# NOTE: go.mod carries a `replace => ../../../authorizer-go` for the unreleased
# SDK client_assertion support. That path is outside this build context, so run
#   go mod vendor
# in this directory first (the vendor/ dir makes the replace path irrelevant),
# or drop the replace once the next authorizer-go tag ships.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /workload .

FROM gcr.io/distroless/static-debian12
COPY --from=build /workload /workload
ENTRYPOINT ["/workload"]
