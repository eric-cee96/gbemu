// Browser UI and emulator startup.
var statusElement = null;
function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
    return (bytes / 1024).toFixed(0) + ' KiB';
}
function initialiseRomPicker() {
    var picker = document.getElementById('rom-file');
    var status = document.getElementById('rom-status');
    var runButton = document.getElementById('run-button');
    var resetButton = document.getElementById('reset-button');
    var canvas = document.getElementById('gbemucanv');
    var speed = document.getElementById('clock-speed');
    var speedValue = document.getElementById('clock-speed-value');
    var soundButton = document.getElementById('sound-button');
    var soundVolume = document.getElementById('sound-volume');
    var soundVolumeValue = document.getElementById('sound-volume-value');
    if (!picker || !status) return;
    statusElement = status;
    if (canvas) {
        canvasContext = canvas.getContext('2d');
        frameImage = canvasContext.createImageData(160, 144);
    }
    if (speed) speed.addEventListener('input', function() {
        clockSpeed = Number(speed.value);
        speedAccumulator = 0;
        if (speedValue) speedValue.textContent = clockSpeed.toFixed(2) + 'Ã—';
    });
    if (soundButton) soundButton.addEventListener('click', ensureAudio);
    if (soundVolume) soundVolume.addEventListener('input', function() {
        var volume = Number(soundVolume.value);
        if (gameBoyApu) gameBoyApu.master.gain.value = volume;
        if (soundVolumeValue) soundVolumeValue.textContent = Math.round(volume * 100) + '%';
    });
    initialiseControls();

    if (runButton) runButton.addEventListener('click', function() {
        if (emulationRunning) pauseEmulation(); else startEmulation();
    });
    if (resetButton) resetButton.addEventListener('click', resetEmulation);

    picker.addEventListener('change', async function() {
        var file = picker.files && picker.files[0];
        if (!file) {
            status.textContent = 'No ROM loaded.';
            status.classList.remove('error');
            return;
        }

        status.textContent = 'Loading ' + file.name + 'â€¦';
        status.classList.remove('error');
        try {
            pauseEmulation();
            var info = loadRomBytes(new Uint8Array(await file.arrayBuffer()));
            status.textContent = info.title + ' â€” ' + formatSize(info.bytes) +
                ' â€” ' + info.cartridgeTypeName + ' (0x' +
                info.cartridgeType.toString(16).padStart(2, '0').toUpperCase() + ')';
            if (runButton) runButton.disabled = false;
            if (resetButton) resetButton.disabled = false;
            startEmulation();
        } catch (error) {
            loadedRom = null;
            status.textContent = 'Could not load ROM: ' + error.message;
            status.classList.add('error');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseRomPicker);
} else {
    initialiseRomPicker();
}
