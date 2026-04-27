# ═══════════════════════════════════════════════════════════
# Smart Psych API - Dockerfile
# ═══════════════════════════════════════════════════════════

# Use official Node.js LTS Alpine image (lightweight)
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Install system dependencies needed for bcrypt and other native modules
RUN apk add --no-cache python3 make g++

# Copy package files first (for better Docker layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY . .

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001 -G nodejs && \
    chown -R nodeapp:nodejs /app

# Switch to non-root user
USER nodeapp

# Expose the application port
EXPOSE 3000

# Health check (optional but recommended)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "server.js"]
