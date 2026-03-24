@echo off
title Envoi vers GitHub - SpotShare
color 0b

echo =======================================
echo     DEPLOIEMENT GITHUB - SPOTSHARE
echo =======================================
echo.

echo [1/3] Ajout des fichiers modifies...
git add .
echo.

echo [2/3] Creation du commit...
set /p commit_msg="Veuillez entrer une description courte de vos modifications : "

if "%commit_msg%"=="" (
    echo.
    echo ATTENTION: Aucun message de commit entre. Le script va s'arreter.
    pause
    exit /b
)

git commit -m "%commit_msg%"
echo.

echo [3/3] Envoi vers GitHub...
git push origin main

echo.
echo =======================================
echo     ✅  TERMINE AVEC SUCCES !
echo =======================================
pause
