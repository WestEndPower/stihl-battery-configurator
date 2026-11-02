"""Real local Git integration checks. Requires git, node and pwsh on PATH."""
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'Commit-Push-STIHL.ps1'

class PublisherGitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='stihl-publish-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'origin.git'
        self.local = self.root / 'local'
        self.other = self.root / 'other'
        self.git(self.root, 'init', '--bare', '--initial-branch=main', str(self.remote))
        self.git(self.root, 'clone', str(self.remote), str(self.local))
        self.configure(self.local)
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,100\n')
        self.write(self.local, 'brands/toro/data/products.csv', 'sku,price\nMOWER,200\n')
        self.write(self.local, 'brands/stihl/data/accessories.csv', 'sku,price\nACCESSORY,20\n')
        self.write(self.local, 'data/marketplace-catalog.json', 'original\n')
        self.write(self.local, 'marketplace.html', 'original website\n')
        self.write(self.local, 'scripts/build-marketplace-catalog.cjs',
                   "const fs=require('fs'); fs.writeFileSync('data/marketplace-catalog.json',"
                   "fs.readFileSync('brands/stihl/data/products.csv','utf8')+"
                   "fs.readFileSync('brands/toro/data/products.csv','utf8'));\n")
        self.commit(self.local)
        self.git(self.local, 'push', '-u', 'origin', 'main')
        self.git(self.root, 'clone', str(self.remote), str(self.other))
        self.configure(self.other)
        # Load only function declarations, never the actual export/publish entry point.
        source = SCRIPT.read_text(encoding='utf-8-sig')
        helpers = source[source.index('function Assert-GitRepository'):source.index('\ntry {\n    Assert-GitRepository')]
        self.harness = self.root / 'harness.ps1'
        self.harness.write_text("param([string]$Repo,[string]$Mode)\n$ErrorActionPreference='Stop'\n"
            "if($env:OS -ne 'Windows_NT'){Set-Alias -Name node.exe -Value (Get-Command node).Source}\n" + helpers +
            "\ntry { Assert-GitRepository $Repo; if($Mode -eq 'push'){ Commit-And-Push $Repo 'West End Marketplace' }"
            "else { Prepare-Repository $Repo 'West End Marketplace' -Marketplace }; exit 0 } catch { Write-Host $_; exit 1 }\n")
        self.env = dict(os.environ)

    def git(self, cwd, *args):
        result = subprocess.run(['git', *args], cwd=cwd, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def configure(self, repo):
        self.git(repo, 'config', 'user.email', 'test@example.test')
        self.git(repo, 'config', 'user.name', 'Publisher Test')

    def write(self, repo, path, text):
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, repo):
        self.git(repo, 'add', '-A')
        self.git(repo, 'commit', '-m', 'fixture changes')

    def remote_commit(self):
        self.commit(self.other)
        self.git(self.other, 'push')

    def run_publisher(self, mode='prepare', success=True):
        result = subprocess.run([shutil.which('pwsh'), '-NoProfile', '-File', str(self.harness),
                                 str(self.local), mode], text=True, capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return result

    def test_fetches_website_update_and_retains_uncommitted_workbook_export(self):
        self.write(self.other, 'marketplace.html', 'new website\n')
        self.remote_commit()
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,120\n')
        self.run_publisher('push')
        self.assertEqual((self.local / 'marketplace.html').read_text(), 'new website\n')
        self.assertIn('TOOL,120', (self.local / 'data/marketplace-catalog.json').read_text())
        self.assertEqual(self.git(self.local, 'status', '--porcelain'), '')
        self.assertEqual(self.git(self.local, 'rev-parse', 'HEAD'), self.git(self.remote, 'rev-parse', 'main'))

    def test_diverged_catalog_and_stihl_conflicts_keep_local_export_and_remote_other_brand(self):
        self.write(self.other, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,999\n')
        self.write(self.other, 'brands/toro/data/products.csv', 'sku,price\nMOWER,300\n')
        self.write(self.other, 'data/marketplace-catalog.json', 'remote generated catalog\n')
        self.write(self.other, 'marketplace.html', 'new website\n')
        self.remote_commit()
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,120\n')
        self.write(self.local, 'data/marketplace-catalog.json', 'local generated catalog\n')
        self.run_publisher('push')
        catalog = (self.local / 'data/marketplace-catalog.json').read_text()
        self.assertIn('TOOL,120', catalog)
        self.assertIn('MOWER,300', catalog)
        self.assertNotIn('999', catalog)
        self.assertEqual((self.local / 'marketplace.html').read_text(), 'new website\n')

    def test_code_conflict_aborts_merge_and_keeps_local_work_committed(self):
        self.write(self.other, 'marketplace.html', 'remote website\n')
        self.remote_commit()
        self.write(self.local, 'marketplace.html', 'local website\n')
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,120\n')
        self.run_publisher(success=False)
        self.assertEqual((self.local / 'marketplace.html').read_text(), 'local website\n')
        self.assertEqual(self.git(self.local, 'status', '--porcelain'), '')
        self.assertFalse((self.local / '.git/MERGE_HEAD').exists())
        self.assertIn('TOOL,120', self.git(self.local, 'show', 'HEAD:brands/stihl/data/products.csv'))

    def test_failed_catalog_build_does_not_push(self):
        self.write(self.other, 'scripts/build-marketplace-catalog.cjs', 'process.exit(1);\n')
        self.remote_commit()
        remote_head = self.git(self.remote, 'rev-parse', 'main')
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,120\n')
        self.run_publisher('push', success=False)
        self.assertEqual(self.git(self.remote, 'rev-parse', 'main'), remote_head)
        self.assertIn('TOOL,120', self.git(self.local, 'show', 'HEAD:brands/stihl/data/products.csv'))

    def test_remote_update_during_push_is_fetched_and_retried(self):
        if os.name == 'nt':
            self.skipTest('The race fixture uses a POSIX hook.')
        hook = self.local / '.git/hooks/pre-push'
        marker = self.root / 'raced'
        other = shlex.quote(str(self.other))
        hook.write_text('#!/bin/sh\nif [ ! -f ' + shlex.quote(str(marker)) + ' ]; then\n' +
                        'touch ' + shlex.quote(str(marker)) + '\n' +
                        'echo raced-website > ' + shlex.quote(str(self.other / 'marketplace.html')) + '\n' +
                        'git -C ' + other + ' add marketplace.html\n' +
                        'git -C ' + other + ' commit -m race\n' +
                        'git -C ' + other + ' push\nfi\nexit 0\n')
        hook.chmod(0o755)
        self.write(self.local, 'brands/stihl/data/products.csv', 'sku,price\nTOOL,120\n')
        self.run_publisher('push')
        self.assertEqual((self.local / 'marketplace.html').read_text(), 'raced-website\n')
        self.assertIn('TOOL,120', (self.local / 'data/marketplace-catalog.json').read_text())
        self.assertEqual(self.git(self.local, 'rev-parse', 'HEAD'), self.git(self.remote, 'rev-parse', 'main'))

    def test_existing_merge_is_rejected_before_staging_conflicts(self):
        self.write(self.other, 'marketplace.html', 'remote website\n')
        self.remote_commit()
        self.write(self.local, 'marketplace.html', 'local website\n')
        self.commit(self.local)
        self.git(self.local, 'fetch', 'origin')
        merge = subprocess.run(['git', 'merge', 'origin/main'], cwd=self.local, capture_output=True)
        self.assertNotEqual(merge.returncode, 0)
        before = self.git(self.local, 'status', '--porcelain')
        self.run_publisher(success=False)
        self.assertEqual(self.git(self.local, 'status', '--porcelain'), before)
        self.assertTrue((self.local / '.git/MERGE_HEAD').exists())

    def test_intentional_export_removal_is_preserved_on_modify_delete_conflict(self):
        self.write(self.other, 'brands/stihl/data/accessories.csv', 'sku,price\nACCESSORY,30\n')
        self.remote_commit()
        (self.local / 'brands/stihl/data/accessories.csv').unlink()
        self.run_publisher('push')
        self.assertFalse((self.local / 'brands/stihl/data/accessories.csv').exists())
        self.assertEqual(self.git(self.local, 'status', '--porcelain'), '')

if __name__ == '__main__':
    unittest.main()
