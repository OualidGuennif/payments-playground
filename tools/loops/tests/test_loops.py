#!/usr/bin/env python3
"""Exercise disabled/dry runs, native arguments, severity routing and real timeout behavior."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import time

ROOT=Path(__file__).resolve().parents[3]


class LoopTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve()
        shutil.copytree(ROOT/'loops',self.root/'loops')
        shutil.copytree(ROOT/'tools/loops',self.root/'tools/loops')
        shutil.copytree(ROOT/'tools/architecture',self.root/'tools/architecture')
        (self.root/'tools/context').mkdir(parents=True)
        native=self.root/'tools/context/run'
        native.write_text('#!/usr/bin/env python3\nimport json,sys\nfrom pathlib import Path\nPath("invocation.json").write_text(json.dumps(sys.argv[1:]))\n')
        native.chmod(0o755)
        gh=self.root/'gh';gh.write_text('#!/bin/sh\nprintf "%s\\n" agent-ready severity:high\n');gh.chmod(0o755)
        self.env={**os.environ,'PATH':str(self.root)+os.pathsep+os.environ['PATH']}

    def call(self,*args):
        return subprocess.run(['bash',str(self.root/'loops/orchestrator.sh'),*args],cwd=self.root,
                              env=self.env,capture_output=True,text=True,timeout=10)

    def configure(self,extra=''):
        (self.root/'env.local').write_text('LOOPS_ENABLED=true\n'+extra)

    def test_disabled_and_dry_runs_never_launch_agent(self):
        self.assertEqual(self.call('outer').returncode,0)
        self.configure()
        self.assertEqual(self.call('outer','--dry-run').returncode,0)
        self.assertFalse((self.root/'invocation.json').exists())

    def test_read_only_jobs_write_only_their_body_files(self):
        for job in ('outer','docs','security','middle'):
            tools=[line for line in self.call(job,'--dry-run').stderr.splitlines() if line.startswith('tools=')][0]
            writes=[tool for tool in tools[6:].split(',') if tool.startswith(('Write','Edit'))]
            self.assertEqual(writes,['Write(.aeion/loop-bodies/**)'],job)
            self.assertIn('Bash(tools/knowledge/doc-links --for *)',tools)

    def test_enabled_high_severity_routes_model_and_supplies_turn_cap(self):
        self.configure()
        result=self.call('inner','--issue','42')
        self.assertEqual(result.returncode,0,result.stderr)
        args=json.loads((self.root/'invocation.json').read_text())
        self.assertEqual(args[args.index('--model')+1],'opus')
        self.assertEqual(args[args.index('--effort')+1],'high')
        self.assertEqual(args[args.index('--max-turns')+1],'30')

    def test_explicit_model_override_wins_and_bad_limits_refuse(self):
        self.configure('INNER_LOOP_MODEL=chosen-model\nLOOP_MAX_TURNS=7\n')
        self.assertEqual(self.call('inner','--issue','42').returncode,0)
        args=json.loads((self.root/'invocation.json').read_text())
        self.assertEqual(args[args.index('--model')+1],'chosen-model')
        self.assertEqual(args[args.index('--max-turns')+1],'7')
        self.configure('LOOP_TIMEOUT_SECONDS=0\n')
        self.assertNotEqual(self.call('outer').returncode,0)

    def test_deadline_stops_a_real_sleeping_job(self):
        result=subprocess.run(['python3',str(ROOT/'tools/loops/run'),'--timeout','1','--',
                               'python3','-c','import time; time.sleep(30)'],capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,124)

    def test_terminating_wrapper_cancels_its_native_child(self):
        marker=self.root/'child-completed'
        ready=self.root/'child-ready'
        command=f'from pathlib import Path; import time; Path({str(ready)!r}).touch(); time.sleep(1); Path({str(marker)!r}).touch()'
        process=subprocess.Popen(['python3',str(ROOT/'tools/loops/run'),'--timeout','20','--','python3','-c',command],
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                if ready.exists():break
                time.sleep(0.02)
            self.assertTrue(ready.exists())
            process.terminate()
            self.assertEqual(process.wait(timeout=3),130)
            time.sleep(1.1)
            self.assertFalse(marker.exists())
        finally:
            if process.poll() is None:process.kill();process.wait()


if __name__=='__main__':unittest.main()
