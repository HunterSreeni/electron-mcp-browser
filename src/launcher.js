import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const PLATFORM = process.platform; // 'win32', 'darwin', 'linux'

const CHROME_CANDIDATES = {
    win32: [
        process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
            : null,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
            : null,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean),
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/local/bin/chromium',
        '/opt/homebrew/bin/chromium',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/local/bin/google-chrome',
    ],
};

function findChromeInPath() {
    try {
        if (PLATFORM === 'win32') {
            const found = execSync('where chrome', { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().trim().split('\n')[0].trim();
            if (found && existsSync(found)) return found;
        } else {
            const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
            for (const name of names) {
                try {
                    const found = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
                        .toString().trim();
                    if (found) return found;
                } catch { /* not in PATH */ }
            }
        }
    } catch { /* PATH lookup failed */ }
    return null;
}

export function findChrome() {
    const envOverride = process.env.ELECTRONIUM_CHROME_PATH;
    if (envOverride) {
        if (!existsSync(envOverride)) throw new Error(`ELECTRONIUM_CHROME_PATH not found: ${envOverride}`);
        return envOverride;
    }
    const candidates = CHROME_CANDIDATES[PLATFORM] || CHROME_CANDIDATES.linux;
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    const fromPath = findChromeInPath();
    if (fromPath) return fromPath;
    return null;
}

export function getDefaultUserDataDir() {
    const home = os.homedir();
    if (PLATFORM === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return path.join(localAppData, 'electronium-profile');
    }
    if (PLATFORM === 'darwin') return path.join(home, 'Library', 'Application Support', 'electronium-profile');
    return path.join(home, '.config', 'electronium-profile');
}

export function launchChrome({ port = 9222, userDataDir, headless = false } = {}) {
    const chromePath = findChrome();
    if (!chromePath) {
        const installHint = {
            win32: 'Install from https://www.google.com/chrome or set ELECTRONIUM_CHROME_PATH',
            darwin: 'Install from https://www.google.com/chrome or brew install --cask google-chrome',
            linux: 'Run: sudo apt install google-chrome-stable  or  sudo snap install chromium',
        }[PLATFORM] || 'Install Google Chrome or set ELECTRONIUM_CHROME_PATH';
        throw new Error(`Chrome not found on ${PLATFORM}. ${installHint}`);
    }

    const dataDir = userDataDir || process.env.ELECTRONIUM_CHROME_DIR || getDefaultUserDataDir();

    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dataDir}`,
        '--exclude-switches=enable-automation',
        '--no-first-run',
        '--no-default-browser-check',
    ];

    // --start-maximized works on Linux and is a hint on Windows; ignored on macOS (osascript handles it)
    if (PLATFORM !== 'darwin') args.push('--start-maximized');

    if (headless) args.push('--headless=new', '--disable-gpu');

    const proc = spawn(chromePath, args, { detached: true, stdio: 'ignore', shell: false });
    proc.unref();

    return { pid: proc.pid, chromePath, dataDir, port };
}

export function getLaunchCommand(port = 9222) {
    const dataDirs = {
        win32: '%LOCALAPPDATA%\\electronium-profile',
        darwin: '~/Library/Application Support/electronium-profile',
        linux: '~/.config/electronium-profile',
    };
    const stealth = `--exclude-switches=enable-automation --no-first-run --start-maximized`;

    return {
        win32: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port} --user-data-dir="${dataDirs.win32}" ${stealth}`,
        darwin: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${port} --user-data-dir="${dataDirs.darwin}" ${stealth}`,
        linux: `google-chrome --remote-debugging-port=${port} --user-data-dir="${dataDirs.linux}" ${stealth}`,
        current: PLATFORM,
    };
}
