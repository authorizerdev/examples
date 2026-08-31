package main

import (
    "log"
    "net/http"
    "strings"
    "github.com/authorizerdev/authorizer-go"
    "github.com/gin-gonic/gin"
    "github.com/gin-contrib/cors"
    "github.com/joho/godotenv" // For loading .env files
    "os"
)

// HealthCheckHandler handles health check requests
func HealthCheckHandler(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "status": "UP",
        "message": "Service is running smoothly",
    })
}

// User struct to represent user data
type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

var users = []User{
    {ID: 1, Name: "Alice", Email: "alice@example.com"},
    {ID: 2, Name: "Bob", Email: "bob@example.com"},
}

// GetUsersHandler returns the list of users
func GetUsersHandler(c *gin.Context) {
    c.JSON(http.StatusOK, users)
}

// AddUserHandler adds a new user
func AddUserHandler(c *gin.Context) {
    var newUser User
    if err := c.ShouldBindJSON(&newUser); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    newUser.ID = len(users) + 1
    users = append(users, newUser)
    c.JSON(http.StatusCreated, newUser)
}

func AuthorizeMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Optional: add conditions here for open routes that don't require authentication

		authHeader := c.Request.Header.Get("Authorization")
		tokenSplit := strings.Split(authHeader, " ")
        log.Println(tokenSplit[1])

		// Replace with your Authorizer credentials
		clientID := "882720ca-81cc-4925-9d33-41035d6c758f"
		authorizerURL := "http://localhost:8080"
		redirectURL := ""

		defaultHeaders := map[string]string{}
		authorizerClient, err := authorizer.NewAuthorizerClient(clientID, authorizerURL, redirectURL, defaultHeaders)
		if err != nil {
            log.Println(`authorizerClient have problem`)
			// Unauthorized response if client initialization fails
			c.AbortWithStatusJSON(http.StatusUnauthorized, "unauthorized")
			return
		}

		if len(tokenSplit) < 2 || tokenSplit[1] == "" {
            log.Println(`token have problem`)
			// Unauthorized response for invalid token format
			c.AbortWithStatusJSON(http.StatusUnauthorized, "unauthorized")
			return
		}

		// Validate the token
		res, err := authorizerClient.ValidateJWTToken(&authorizer.ValidateJWTTokenInput{
			TokenType: authorizer.TokenTypeAccessToken,
			Token:     tokenSplit[1],
		})
		if err != nil || !res.IsValid {
            log.Println(`validation have problem`)
			// Unauthorized response for invalid token
			c.AbortWithStatusJSON(http.StatusUnauthorized, "unauthorized cant aboe to find")
			return
		}

		// Proceed with the request if the token is valid
		c.Next()
	}
}


// Main function to set up and run the server
func main() {
    // Load environment variables
    if err := godotenv.Load(); err != nil {
        log.Println("No .env file found")
    }

    port := os.Getenv("PORT")
    if port == "" {
        port = "8080" // Default port if not specified
    }

    r := gin.Default()
    r.Use(cors.New(cors.Config{
        AllowOrigins:     []string{"http://localhost:3000"},
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
        ExposeHeaders:    []string{"Content-Length"},
        AllowCredentials: true,
    }))
    
    r.Use(cors.Default())
    r.Use(AuthorizeMiddleware())
    

    // Define routes
    r.GET("/health", HealthCheckHandler)
    r.GET("/users", GetUsersHandler)
    r.POST("/users", AddUserHandler)

    // Start the server
    log.Printf("Starting server on port %s", port)
    if err := r.Run(":" + port); err != nil {
        log.Fatalf("Could not start server: %v", err)
    }
}
