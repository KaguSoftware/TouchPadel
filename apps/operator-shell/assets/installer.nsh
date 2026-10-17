# Forces the per-user install (no "just me / everyone" page, no UAC prompt).
# `isForceCurrentInstall` is read by app-builder-lib multiUserUi.nsh.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
