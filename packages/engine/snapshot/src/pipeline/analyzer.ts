import { Dirent, promises as fs } from 'fs';
import path from 'path';
import { JulionManifest } from 'julion-core';

export interface ProjectMetadata {
  name: string;
  root: string;
  framework: string;
  language: string;
  entryPoints: string[];
  buildSystem: string[];
  environmentType: string;
  structure: { directories: string[]; files: string[] };
  createdAt: string;
}

function isDirectory(dirent: Dirent) {
  return dirent.isDirectory();
}

async function walkFiles(root: string, dir = '.', fileList: string[] = [], dirList: string[] = []) {
  const directory = path.join(root, dir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith('.on')) continue;
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirList.push(relative);
      await walkFiles(root, relative, fileList, dirList);
      continue;
    }
    if (entry.isFile()) {
      fileList.push(relative);
    }
  }
  return { fileList, dirList };
}

function detectFramework(packageJson: any, composerJson: any) {
  if (composerJson?.require?.['laravel/framework']) {
    return 'laravel';
  }
  if (packageJson?.dependencies?.react || packageJson?.devDependencies?.react) {
    return 'react';
  }
  if (packageJson?.dependencies?.vue || packageJson?.devDependencies?.vue) {
    return 'vue';
  }
  if (packageJson?.dependencies?.next || packageJson?.devDependencies?.next) {
    return 'next';
  }
  if (packageJson?.dependencies?.express || packageJson?.devDependencies?.express) {
    return 'express';
  }
  if (packageJson?.dependencies?.['@nestjs'] || packageJson?.devDependencies?.['@nestjs']) {
    return 'node';
  }
  return 'generic';
}

function detectLanguages(files: string[]) {
  const extSet = new Set<string>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    switch (ext) {
      case '.php':
        extSet.add('php');
        break;
      case '.js':
      case '.jsx':
      case '.ts':
      case '.tsx':
        extSet.add('javascript');
        break;
      case '.py':
        extSet.add('python');
        break;
      case '.html':
      case '.css':
      case '.scss':
      case '.sass':
        extSet.add('markup');
        break;
      default:
        break;
    }
  }
  return Array.from(extSet.size ? extSet : ['unknown']);
}

function detectEntryPoints(files: string[]) {
  const candidates = ['index.js', 'index.ts', 'server.js', 'app.js', 'artisan', 'manage.py', 'package.json', 'composer.json'];
  return files.filter((file) => candidates.includes(path.basename(file))).slice(0, 6);
}

function detectBuildSystems(packageJson: any, composerJson: any) {
  const systems: string[] = [];
  if (packageJson?.scripts) {
    systems.push('npm');
  }
  if (packageJson?.devDependencies?.vite || packageJson?.devDependencies?.webpack || packageJson?.dependencies?.vite) {
    systems.push('vite');
  }
  if (composerJson) {
    systems.push('composer');
  }
  return Array.from(new Set(systems));
}

function detectEnvironmentType(files: string[]) {
  if (files.some((file) => file.startsWith('.env'))) {
    return 'dotenv';
  }
  if (files.some((file) => file.endsWith('.env.example'))) {
    return 'dotenv-sample';
  }
  return 'standard';
}

async function loadJson(filePath: string) {
  try {
    const file = await fs.readFile(filePath, 'utf8');
    return JSON.parse(file);
  } catch {
    return null;
  }
}

export async function analyzeProject(root: string) {
  const { fileList, dirList } = await walkFiles(root);
  const packageJson = await loadJson(path.join(root, 'package.json'));
  const composerJson = await loadJson(path.join(root, 'composer.json'));
  const framework = detectFramework(packageJson, composerJson);
  const languages = detectLanguages(fileList);
  const entryPoints = detectEntryPoints(fileList);
  const buildSystem = detectBuildSystems(packageJson, composerJson);
  const environmentType = detectEnvironmentType(fileList);

  const metadata: ProjectMetadata = {
    name: packageJson?.name || composerJson?.name || path.basename(root),
    root,
    framework,
    language: languages.join(', '),
    entryPoints,
    buildSystem,
    environmentType,
    structure: {
      directories: dirList,
      files: fileList
    },
    createdAt: new Date().toISOString()
  };

  const manifest: JulionManifest = {
    name: metadata.name,
    framework: metadata.framework,
    language: languages[0] || 'unknown',
    framework_version: packageJson?.dependencies?.react || composerJson?.require?.['laravel/framework'] || 'unknown',
    runtime_version: packageJson?.engines?.node || composerJson?.require?.php || 'unknown',
    dependencies: {},
    modules: [],
    routes: [],
    created_at: metadata.createdAt,
    julion_version: '1.0',
    adapter: metadata.framework,
    ignore: [
      'vendor/',
      'node_modules/',
      '.git/',
      '.env',
      'storage/logs/',
      'cache/',
      'tmp/',
      'dist/',
      'build/',
      '*.on'
    ]
  };

  return { metadata, manifest };
}
