!macro customInstall
  # electron-builder preserves intentionally missing shortcuts on upgrades.
  # Neuron's Start menu entry must instead be restored on every installation.
  # Use its resolved install context and link path, including custom folders.
  !insertmacro createMenuDirectory
  SetOutPath "$INSTDIR"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  StrCpy $launchLink "$newStartMenuLink"
!macroend
