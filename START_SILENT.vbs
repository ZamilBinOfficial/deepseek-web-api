Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "Z:\Hub\projects\deepseek-web-api"
WshShell.Run "cmd /c set PORT=8080&& set DS_API_KEY=sk-deepseek&& node dist/index.js start", 0, False
