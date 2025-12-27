package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// CSRF protection using synchronizer token pattern with rotation
type CSRFMiddleware struct {
	currentToken     string
	previousToken    string
	mu               sync.RWMutex
	rotationInterval time.Duration
	gracePeriod      time.Duration
	lastRotation     time.Time
	stopChan         chan struct{} // For graceful shutdown of rotation loop
}

// NewCSRFMiddleware creates CSRF middleware with automatic token rotation
func NewCSRFMiddleware() (*CSRFMiddleware, error) {
	return NewCSRFMiddlewareWithRotation(time.Hour, time.Minute)
}

// NewCSRFMiddlewareWithRotation creates CSRF middleware with configurable rotation
func NewCSRFMiddlewareWithRotation(rotationInterval, gracePeriod time.Duration) (*CSRFMiddleware, error) {
	token, err := generateSecureToken(32)
	if err != nil {
		return nil, fmt.Errorf("failed to create initial CSRF token: %w", err)
	}

	c := &CSRFMiddleware{
		currentToken:     token,
		previousToken:    "",
		rotationInterval: rotationInterval,
		gracePeriod:      gracePeriod,
		lastRotation:     time.Now(),
		stopChan:         make(chan struct{}),
	}
	go c.rotationLoop()
	return c, nil
}

// rotationLoop periodically rotates the CSRF token
func (c *CSRFMiddleware) rotationLoop() {
	ticker := time.NewTicker(c.rotationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.rotate()
		case <-c.stopChan:
			return
		}
	}
}

// Stop stops the rotation loop. Should be called on graceful shutdown.
func (c *CSRFMiddleware) Stop() {
	close(c.stopChan)
}

// rotate generates a new token and keeps the old one for grace period
func (c *CSRFMiddleware) rotate() {
	newToken, err := generateSecureToken(32)
	if err != nil {
		// Log error but keep using current token - don't crash the server
		log.Printf("[CSRF] Failed to rotate token, keeping current: %v", err)
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.previousToken = c.currentToken
	c.currentToken = newToken
	c.lastRotation = time.Now()
	log.Printf("[CSRF] Token rotated")
}

// Token returns the current CSRF token for embedding in responses
func (c *CSRFMiddleware) Token() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentToken
}

// isValidToken checks if the provided token matches current or previous (within grace period)
func (c *CSRFMiddleware) isValidToken(token string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Check current token
	if subtle.ConstantTimeCompare([]byte(token), []byte(c.currentToken)) == 1 {
		return true
	}

	// Check previous token within grace period
	if c.previousToken != "" && time.Since(c.lastRotation) < c.gracePeriod {
		if subtle.ConstantTimeCompare([]byte(token), []byte(c.previousToken)) == 1 {
			return true
		}
	}

	return false
}

// Wrap adds CSRF validation for state-changing methods
func (c *CSRFMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only validate state-changing methods
		if r.Method == "POST" || r.Method == "PUT" || r.Method == "DELETE" || r.Method == "PATCH" {
			token := r.Header.Get("X-CSRF-Token")
			if !c.isValidToken(token) {
				http.Error(w, `{"success":false,"error":{"code":"CSRF_ERROR","message":"Invalid or missing CSRF token"}}`, http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimiter provides simple in-memory rate limiting
type RateLimiter struct {
	requests   map[string][]time.Time
	mu         sync.Mutex
	limit      int
	window     time.Duration
	maxEntries int
	stopChan   chan struct{}
}

// NewRateLimiter creates a rate limiter with specified limit per window
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return NewRateLimiterWithMax(limit, window, 10000) // Default 10k max entries
}

// NewRateLimiterWithMax creates a rate limiter with configurable max entries
func NewRateLimiterWithMax(limit int, window time.Duration, maxEntries int) *RateLimiter {
	rl := &RateLimiter{
		requests:   make(map[string][]time.Time),
		limit:      limit,
		window:     window,
		maxEntries: maxEntries,
		stopChan:   make(chan struct{}),
	}
	// Cleanup old entries periodically
	go rl.cleanup()
	return rl
}

// Stop stops the cleanup goroutine. Should be called on graceful shutdown.
func (rl *RateLimiter) Stop() {
	close(rl.stopChan)
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.window)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for ip, times := range rl.requests {
				var valid []time.Time
				for _, t := range times {
					if now.Sub(t) < rl.window {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(rl.requests, ip)
				} else {
					rl.requests[ip] = valid
				}
			}
			rl.mu.Unlock()
		case <-rl.stopChan:
			return
		}
	}
}

// Allow checks if a request from the given IP is allowed
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	times := rl.requests[ip]

	// Filter to requests within window
	var valid []time.Time
	for _, t := range times {
		if now.Sub(t) < rl.window {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.limit {
		return false
	}

	// Check if we need to evict entries to stay under max
	if _, exists := rl.requests[ip]; !exists && len(rl.requests) >= rl.maxEntries {
		// Evict oldest entry (first one found with oldest timestamp)
		var oldestIP string
		var oldestTime time.Time
		first := true
		for entryIP, entryTimes := range rl.requests {
			if len(entryTimes) > 0 {
				if first || entryTimes[0].Before(oldestTime) {
					oldestIP = entryIP
					oldestTime = entryTimes[0]
					first = false
				}
			}
		}
		if oldestIP != "" {
			delete(rl.requests, oldestIP)
			log.Printf("[RATE_LIMIT] Evicted oldest entry for %s to stay under max entries", oldestIP)
		}
	}

	valid = append(valid, now)
	rl.requests[ip] = valid
	return true
}

// Wrap adds rate limiting to a handler
func (rl *RateLimiter) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Use RemoteAddr directly - don't trust X-Forwarded-For headers.
		// This is a local dev tool with no reverse proxy, so XFF can only
		// come from attackers trying to bypass rate limiting.
		// Production deployments behind proxies would need a configurable
		// "trust proxy" setting, but that's out of scope here.
		ip := r.RemoteAddr

		if !rl.Allow(ip) {
			log.Printf("[RATE_LIMIT] Blocked request from %s", ip)
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"success":false,"error":{"code":"RATE_LIMIT","message":"Too many requests"}}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func generateSecureToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("crypto/rand failed: %w", err)
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

// LimitBodySize wraps a handler with request body size limiting
func LimitBodySize(next http.Handler, maxBytes int64) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		next.ServeHTTP(w, r)
	})
}
