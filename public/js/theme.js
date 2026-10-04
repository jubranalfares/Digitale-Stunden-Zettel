// Hell/Dunkel vor dem ersten Zeichnen setzen, damit die Seite nicht kurz hell aufblitzt.
(() => {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* Speicher gesperrt (z. B. privater Modus): dann gilt die Systemeinstellung. */ }
})();
