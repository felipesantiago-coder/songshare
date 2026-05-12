#!/bin/bash
echo "🚀 Iniciando servidor de sinalização..."
cd signaling-server
echo "📦 Instalando dependências em $(pwd)..."
npm install --production
echo "▶️  Iniciando servidor..."
exec node index.js
