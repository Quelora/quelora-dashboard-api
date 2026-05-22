#!/bin/bash
# Quelora — quelora-dashboard-api
# Copyright (C) 2026 Germán Zelaya — https://quelora.org
# SPDX-License-Identifier: AGPL-3.0-only
#
# This file is part of Quelora. See the LICENSE file for terms.


# --- Iniciar los 3 Seed Processes en segundo plano (background) ---

echo "Iniciando SeedRedditThread.js..."
# Ejecuta el primer seed en background
nohup node SeedRedditThread.js --scheduled &

echo "Iniciando SeedRedditCommentsCoordinator.js..."
# Ejecuta el segundo seed en background
nohup node SeedRedditCommentsCoordinator.js --scheduled &

echo "Iniciando SeedRedditCommentsUpdate.js..."
# Ejecuta el tercer seed en background
nohup node SeedRedditCommentsUpdate.js --interval 3 &

# El comando 'nohup' y el ampersand (&) aseguran que los procesos sigan ejecutándose
# incluso si cierras la sesión y devuelve el control a la terminal.

echo "Los 3 seeds han sido iniciados y están ejecutándose en segundo plano."
echo "Puedes usar 'ps -aux' para verificar su estado."
echo "Control devuelto a la shell."
