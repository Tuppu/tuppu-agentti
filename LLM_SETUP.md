# Setting up llama.cpp Server for Tuppu Agent

## Issue
The llama-server.exe is exiting immediately, which could be due to:
1. Incompatible model format
2. Missing dependencies (Visual C++ Runtime)
3. Incorrect llama.cpp version for the model

## Solutions

### Option 1: Use llama.cpp (Recommended)

1. **Download latest llama.cpp release:**
   - Go to: https://github.com/ggerganov/llama.cpp/releases
   - Download the Windows build (look for `llama-*-bin-win-*.zip`)
   - Extract to `C:\llama`

2. **Install Visual C++ Redistributable (if needed):**
   - Download from: https://aka.ms/vs/17/release/vc_redist.x64.exe
   - Install and restart

3. **Start the server:**
   ```powershell
   cd C:\llama
   .\llama-server.exe -m ".\models\Phi-3-mini-4k-instruct-q4.gguf" --port 8080
   ```

4. **Test it:**
   ```powershell
   curl http://localhost:8080/health
   ```

### Option 2: Use Ollama (Easier Alternative)

Ollama is easier to set up and manage:

1. **Download and install Ollama:**
   ```powershell
   winget install Ollama.Ollama
   ```
   Or download from: https://ollama.ai/download

2. **Start Ollama:**
   ```powershell
   ollama serve
   ```

3. **Pull a model:**
   ```powershell
   ollama pull phi3
   # or
   ollama pull llama3
   ```

4. **Update your `.env` file:**
   ```bash
   LLM_BASE=http://localhost:11434/v1
   ```

5. **Restart your Tuppu Agent**

### Option 3: Use a Remote LLM API

If local LLMs are problematic, you can use a cloud API:

1. **OpenAI:**
   ```bash
   LLM_BASE=https://api.openai.com/v1
   OPENAI_API_KEY=your_api_key_here
   ```

2. **Update models.ts** to use the API key in headers

### Option 4: Run Without LLM (Fallback Mode)

The app will automatically fall back to the Xenova summarizer if the LLM fails. This works without any external LLM server.

## Troubleshooting

### Check if the server is running:
```powershell
netstat -ano | findstr :8080
```

### Test the endpoint:
```powershell
curl http://localhost:8080/v1/models
```

### Check model file:
```powershell
Get-FileHash "C:\llama\models\Phi-3-mini-4k-instruct-q4.gguf"
```

## Recommended: Use Ollama

For Windows users, **Ollama is the easiest option**:
- One-click installation
- Automatic model management
- Built-in server
- OpenAI-compatible API
- No manual configuration needed

```powershell
# Install
winget install Ollama.Ollama

# Run (in one terminal)
ollama serve

# Pull model (in another terminal)
ollama pull phi3

# Your Tuppu Agent will now work!
```

## Current Status

Your setup:
- ✅ Model file exists: `C:\llama\models\Phi-3-mini-4k-instruct-q4.gguf`
- ❌ llama-server.exe is not starting properly
- ✅ Tuppu Agent has fallback to Xenova summarizer

**Recommendation:** Install Ollama for the easiest experience.
