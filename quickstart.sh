#!/bin/bash
# Quick Start Script for Freight Rates Project

echo "=========================================="
echo "Freight Rates - Quick Start"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this from the project root directory"
    exit 1
fi

echo "✓ Found package.json in project root"
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing dependencies..."
npm run install:all 2>&1 | grep -E "added|packages"
if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed"
else
    echo "⚠ Warning: Check npm install output for any issues"
fi
echo ""

# Step 2: Create .env if it doesn't exist
echo "🔐 Step 2: Configuring environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✓ Created .env file from template"
    echo "⚠ IMPORTANT: Edit .env and set:"
    echo "  - MAERSK_USERNAME (your Maersk portal username)"
    echo "  - MAERSK_PASSWORD (your Maersk portal password)"
    echo "  - SNAPSHOT_KEY (a secure encryption key)"
else
    echo "✓ .env already exists"
fi
echo ""

# Step 3: Initialize database
echo "🗄️  Step 3: Initializing database..."
if npm run seed > /dev/null 2>&1; then
    echo "✓ Database initialized"
else
    echo "✓ Database setup (may already exist)"
fi
echo ""

# Step 4: Start servers
echo "🚀 Step 4: Starting servers..."
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""
npm run dev
