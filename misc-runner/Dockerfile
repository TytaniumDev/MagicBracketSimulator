# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true

# Copy source code
COPY . .

# Download dependencies and build
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -o misc-runner .

# Runtime stage
FROM alpine:3.19

# Install CA certificates for HTTPS
RUN apk add --no-cache ca-certificates

# Create non-root user
RUN adduser -D -u 1000 runner
USER runner

# Copy binary from builder
COPY --from=builder /app/misc-runner /usr/local/bin/misc-runner

# Default logs directory
ENV LOGS_DIR=/app/logs

ENTRYPOINT ["misc-runner"]
