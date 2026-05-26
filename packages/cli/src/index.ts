#!/usr/bin/env node
import path from 'path';
import { Command } from 'commander';
import { buildSnapshot, saveUltra } from 'julion-engine-snapshot';
import { restoreSnapshot } from 'julion-engine-restore';
import { authenticate, authenticateViaWebsite, uploadSnapshot, downloadSnapshot } from 'julion-cloud-google-drive';

const program = new Command();

program
  .name('julion')
  .description('JULION developer snapshot CLI')
  .version('0.1.0');

program
  .command('begin')
  .description('Initialize JULION in the current project')
  .action(() => {
    console.log('julion begin: scaffolding project metadata');
  });

program
  .command('seal')
  .description('Create a .on snapshot for the current project')
  .option('--ultra', 'Run the full ultra pipeline')
  .option('-o, --out <path>', 'Output .on snapshot path')
  .option('--deposit', 'Upload the snapshot to Google Drive after creation')
  .option('--repository <name>', 'Drive repository folder name')
  .action(async (options: { ultra?: boolean; out?: string; deposit?: boolean; repository?: string }) => {
    const projectRoot = process.cwd();
    const output = options.out || path.join(projectRoot, `${path.basename(projectRoot)}.on`);

    try {
      if (options.ultra) {
        const result = await saveUltra(projectRoot, {
          outputPath: output,
          push: !!options.deposit,
          repository: options.repository
        });

        console.log(`Created ultra snapshot: ${result.package.outputPath}`);
        console.log('Project summary:', result.metadata);
        console.log('Classification stats:', result.classificationStats);
        console.log('Dependency graph summary:', result.dependencyGraph.dependencies.length, 'entries');
        console.log(`Deduplication savings: ${result.deduplication.savingsPercent}%`);
        console.log(`Compression ratio: ${result.compression.ratio}`);
        console.log(`Final .on file size: ${result.package.size} bytes`);
        if (result.upload) {
          console.log(`Uploaded to Drive: ${result.upload.link}`);
        }
      } else {
        const archive = await buildSnapshot(projectRoot, output, 'generic');
        console.log(`Created snapshot: ${archive}`);
      }
    } catch (error) {
      console.error('Failed to create snapshot:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('unseal')
  .description('Restore a .on snapshot into a target folder')
  .argument('<snapshot>', 'Path to the .on snapshot file')
  .argument('[target]', 'Target restore directory')
  .option('--force', 'Overwrite existing files during restore')
  .action(async (snapshot: string, target: string | undefined, options: { force?: boolean }) => {
    const projectRoot = target ? path.resolve(target) : process.cwd();

    try {
      const result = await restoreSnapshot(path.resolve(snapshot), projectRoot, { overwrite: !!options.force });
      console.log(`Restored snapshot ${result.snapshotName} into ${result.targetPath}`);
      console.log(`Files restored: ${result.restoredFiles}/${result.totalFiles}`);
    } catch (error) {
      console.error('Restore failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('deposit')
  .description('Upload a .on snapshot to Google Drive')
  .argument('<snapshot>', 'Path to the .on snapshot file')
  .argument('[repository]', 'Drive repository folder name')
  .action(async (snapshot: string, repository: string | undefined) => {
    try {
      const result = await uploadSnapshot(path.resolve(snapshot), repository);
      console.log(`Uploaded ${result.fileName} to repository ${result.repositoryName} (${result.fileId})`);
    } catch (error) {
      console.error('Push failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('fetch')
  .description('Download a .on snapshot from Google Drive')
  .argument('<repository>', 'Drive repository folder name')
  .argument('<snapshot>', 'Name of the snapshot file to download')
  .option('-o, --out <path>', 'Download destination path')
  .action(async (repository: string, snapshot: string, options: { out?: string }) => {
    const outPath = options.out || path.resolve(snapshot);

    try {
      const result = await downloadSnapshot(snapshot, outPath, repository);
      console.log(`Downloaded ${result.fileName} to ${result.downloadedTo}`);
    } catch (error) {
      console.error('Pull failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('connect')
  .description('Authenticate with cloud providers')
  .argument('<provider>', 'provider name')
  .option('--website', 'Authenticate through the Julion website login flow')
  .action(async (provider: string, options: { website?: boolean }) => {
    if (provider === 'google') {
      try {
        if (options.website) {
          await authenticateViaWebsite();
        } else {
          await authenticate();
        }
      } catch (error) {
        console.error('Authentication failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
      return;
    }

    console.error(`Unsupported provider: ${provider}`);
    process.exit(1);
  });

program.parse(process.argv);
