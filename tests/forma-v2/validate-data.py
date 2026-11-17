#!/usr/bin/env python3
"""Validate local public JSON and synthetic fixtures; never fetch providers.

Requires jsonschema. Run from any directory: python3 tests/forma-v2/validate-data.py
"""
import copy
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]


def schema_from(text):
    return json.loads(re.search(r'```json\n(.*?)\n```', text, re.S)[1])


schema = schema_from((ROOT / 'SCHEMA.md').read_text())
baseline = schema_from(subprocess.check_output(
    ['git', 'show', 'origin/main:SCHEMA.md'], cwd=ROOT, text=True))
existing = copy.deepcopy(schema)
del existing['$defs']['positions-history']
assert existing == baseline, 'The only public contract addition must be positions-history'
Draft202012Validator.check_schema(schema)

# This overlay is confined to tests. Public schemas keep their original names
# and reject targetBand. Fixtures use Fondo A/B/C names from the design spec.
synthetic = copy.deepcopy(schema)
synthetic['$defs']['position']['properties']['asset']['pattern'] = r'^[A-Za-z][A-Za-z0-9 ._-]{0,63}$'
synthetic['$defs']['satellites']['properties']['assets']['items']['properties']['asset']['pattern'] = r'^[A-Za-z][A-Za-z0-9 ._-]{0,63}$'
synthetic['$defs']['position']['properties']['targetBand'] = {
    'type': 'array', 'items': {'type': 'number'}, 'minItems': 2, 'maxItems': 2,
}
Draft202012Validator.check_schema(synthetic)

total = 0
for folder, contract in [('site/data', schema), ('tests/fixtures/synthetic', synthetic)]:
    files = sorted((ROOT / folder).glob('*.json'))
    for file in files:
        definition = {**contract, '$ref': '#/$defs/' + file.stem}
        data = json.loads(file.read_text())
        errors = list(Draft202012Validator(definition, format_checker=FormatChecker()).iter_errors(data))
        # Print paths, not financial content, if validation fails.
        assert not errors, f'{folder}/{file.name}: invalid at {[list(e.absolute_path) for e in errors]}'
        if file.name == 'treasury.json':
            for row in data['positions']:
                if folder == 'site/data':
                    assert 'targetBand' not in row, 'Live positions must carry no band'
                elif 'targetBand' in row:
                    assert row['targetBand'][0] <= row['targetBand'][1]
        total += 1
        print(f'PASS {folder}/{file.name}')
print(f'{total} JSON files valid; existing contracts unchanged; live positions carry no targetBand')
