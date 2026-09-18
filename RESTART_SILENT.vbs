Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "Z:\Hub\projects\deepseek-web-api"
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr "":8080"" ^| findstr ""LISTENING""') do taskkill /f /pid %a >nul 2>&1", 0, True
WScript.Sleep 1000
WshShell.Run "cmd /c set PORT=8080&& set DS_API_KEY=sk-deepseek&& set DS_TOOL_REASONING=clean&& node dist/index.js start", 0, False
