FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /workload .

FROM gcr.io/distroless/static-debian12
COPY --from=build /workload /workload
ENTRYPOINT ["/workload"]
