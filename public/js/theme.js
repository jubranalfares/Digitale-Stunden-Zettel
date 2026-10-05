// Hell/Dunkel vor dem ersten Zeichnen setzen, damit die Seite nicht kurz hell aufblitzt.
(() => {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* Speicher gesperrt (z. B. privater Modus): dann gilt die Systemeinstellung. */ }
  // App vom Home-Bildschirm gestartet: einmal pro Start den animierten Startbildschirm zeigen.
  try {
    const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (standalone && !sessionStorage.getItem('launched')) {
      document.documentElement.classList.add('launching');
      window.launchShownAt = performance.now(); // ab hier ist der Startbildschirm zu sehen
      sessionStorage.setItem('launched', '1');
    }
  } catch { /* ohne Speicher kein Startbildschirm */ }
})();
