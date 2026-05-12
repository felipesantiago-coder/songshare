#!/bin/bash
set -e # Para o script se houver erro

echo "🚀 Iniciando instalação das dependências..."
npm install --omit=dev

echo "✅ Instalação concluída. Iniciando o servidor de sinalização..."
# Certifique-se que o caminho para o arquivo do servidor está correto
node server-sinalizacao.js
