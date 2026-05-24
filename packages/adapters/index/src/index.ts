import { promises as fs } from 'fs';
import path from 'path';
import { AdapterEntry, AdapterModule } from './types';

const BASE_ADAPTERS_DIR = path.resolve(__dirname, '..', '..');

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(filePath: string): Promise<any | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requireAdapter(packageName: string, adapterPath: string): AdapterModule | undefined {
  try {
    return require(packageName) as AdapterModule;
  } catch {
    const distEntry = path.join(adapterPath, 'dist', 'index.js');
    try {
      return require(distEntry) as AdapterModule;
    } catch {
      return undefined;
    }
  }
}

export async function discoverAdapters(adaptersRoot = BASE_ADAPTERS_DIR): Promise<AdapterEntry[]> {
  const entries = await fs.readdir(adaptersRoot, { withFileTypes: true });
  const adapters: AdapterEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'index') {
      continue;
    }

    const adapterDir = path.join(adaptersRoot, entry.name);
    const packageJson = await loadJson(path.join(adapterDir, 'package.json'));
    const packageName = packageJson?.name || entry.name;
    const module = requireAdapter(packageName, adapterDir);

    if (!module) {
      continue;
    }

    adapters.push({
      name: packageName,
      module,
      path: adapterDir
    });
  }

  return adapters;
}

export async function getAdapter(adapterName: string, adaptersRoot = BASE_ADAPTERS_DIR): Promise<AdapterEntry | undefined> {
  const adapters = await discoverAdapters(adaptersRoot);
  return adapters.find((adapter) => adapter.name === adapterName);
}

export async function detectProject(root: string, adaptersRoot = BASE_ADAPTERS_DIR): Promise<AdapterModule | undefined> {
  const adapters = await discoverAdapters(adaptersRoot);
  let genericAdapter: AdapterModule | undefined;

  for (const adapter of adapters) {
    if (adapter.module.adapterName === 'generic') {
      genericAdapter = adapter.module;
      continue;
    }

    if (typeof adapter.module.detectProject === 'function') {
      try {
        if (await adapter.module.detectProject(root)) {
          return adapter.module;
        }
      } catch {
        continue;
      }
    }
  }

  return genericAdapter;
}

export async function listAdapterNames(adaptersRoot = BASE_ADAPTERS_DIR): Promise<string[]> {
  const adapters = await discoverAdapters(adaptersRoot);
  return adapters.map((adapter) => adapter.name);
}
