@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo QALA LAB — запуск сайта
echo.
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
if exist node_modules\vite\bin\vite.js goto start_site
echo Первый запуск: устанавливаем необходимые файлы. Подождите...
call npm.cmd ci
if errorlevel 1 goto install_failed
:start_site
echo.
echo Откройте http://localhost:5173 после появления строки Local.
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
echo.
call npm.cmd run dev
goto finished
:missing_node
echo Установите Node.js LTS с https://nodejs.org/en/download
echo Затем запустите этот файл снова.
goto finished
:install_failed
echo Не удалось установить файлы. Проверьте интернет и попробуйте снова.
:finished
echo.
pause
