#!/bin/bash

# Simple test script for create-p1-starter-kit
# This creates a test project without prompts for validation

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd /tmp
rm -rf test-p1-starter-validation

# Copy template manually to validate structure
mkdir -p test-p1-starter-validation
node -e "
  import { copyTemplate } from '${SCRIPT_DIR}/lib/copy-template.js';
  copyTemplate('/tmp/test-p1-starter-validation', 'test-p1-starter');
  console.log('✓ Template copied successfully');
"

cd test-p1-starter-validation

echo ""
echo "Validating project structure..."

# Check key files exist
for file in package.json next.config.mjs puck.config.tsx .env.example tsconfig.json; do
  if [ -f "$file" ]; then
    echo "✓ $file exists"
  else
    echo "✗ $file missing"
    exit 1
  fi
done

# Check key directories exist
for dir in app components lib __tests__; do
  if [ -d "$dir" ]; then
    echo "✓ $dir/ exists"
  else
    echo "✗ $dir/ missing"
    exit 1
  fi
done

# Check package.json has correct project name
PROJECT_NAME=$(node -pe "require('./package.json').name")
if [ "$PROJECT_NAME" = "test-p1-starter" ]; then
  echo "✓ package.json name is correct: $PROJECT_NAME"
else
  echo "✗ package.json name is wrong: $PROJECT_NAME"
  exit 1
fi

# Check workspace deps were replaced
if grep -q "workspace:" package.json; then
  echo "✗ workspace: dependencies found (should be published versions)"
  exit 1
else
  echo "✓ No workspace: dependencies (using published versions)"
fi

# Check for GitHub Packages versions (validate format, not specific version)
if grep -q '"@pantheon-systems/css-client": "\^[0-9]\+\.[0-9]\+\.[0-9]\+"' package.json; then
  echo "✓ css-client has valid version format"
else
  echo "✗ css-client version format is invalid"
  exit 1
fi

echo ""
echo "✓ All validation checks passed!"
echo ""
echo "Test project created at: /tmp/test-p1-starter-validation"
