"""Optional Windows syntax pass; does not replace Swift/Xcode type checking."""
import pathlib, sys, plistlib, hashlib, json
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools' / 'ios-checks'))
from tree_sitter import Language, Parser
import tree_sitter_swift
parser = Parser(Language(tree_sitter_swift.language()))
errors = []
files = list((root / 'mobile' / 'ios').rglob('*.swift'))
for file in files:
    tree = parser.parse(file.read_bytes())
    def visit(node):
        if node.type == 'ERROR' or node.is_missing:
            errors.append(f'{file.relative_to(root)}:{node.start_point.row + 1}:{node.start_point.column + 1}: {node.type}')
        for child in node.children:
            visit(child)
    visit(tree.root_node)
for file in (root / 'mobile' / 'ios' / 'App').iterdir():
    if file.suffix in ('.plist', '.xcprivacy'):
        plistlib.loads(file.read_bytes())
fixtures = root / 'mobile' / 'ios' / 'Tests' / 'Fixtures'
for name, digest in json.loads((fixtures / 'sha256.json').read_text()).items():
    assert hashlib.sha256((fixtures / name).read_bytes()).hexdigest() == digest, name
if errors:
    print('\n'.join(errors)); sys.exit(1)
print(f'{len(files)} Swift files: syntax trees parsed; plist and fixture hashes valid. Xcode compile NOT performed.')
