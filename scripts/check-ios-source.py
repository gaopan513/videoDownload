"""Optional Windows syntax pass; does not replace Swift/Xcode type checking."""
import importlib, json, hashlib, pathlib, plistlib, sys
root = pathlib.Path(__file__).resolve().parents[1]
# Prefer the vendored copies, but fall back to whatever the interpreter can import
# so the check still runs when the local directory is only a placeholder.
sys.path.insert(0, str(root / '.tools' / 'ios-checks'))
try:
    from tree_sitter import Language, Parser
    import tree_sitter_swift
except ImportError as error:
    print(f'tree-sitter unavailable ({error}); install tree_sitter and tree_sitter_swift, or run this check on macOS.')
    sys.exit(2)
parser = Parser(Language(tree_sitter_swift.language()))

errors = []
files = sorted((root / 'mobile' / 'ios').rglob('*.swift'))
for file in files:
    tree = parser.parse(file.read_bytes())
    # Iterative walk: a recursive visitor can exceed the stack on deep trees.
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type == 'ERROR' or node.is_missing:
            errors.append(f'{file.relative_to(root)}:{node.start_point[0] + 1}:{node.start_point[1] + 1}: {node.type}')
        stack.extend(node.children)
for file in (root / 'mobile' / 'ios' / 'App').iterdir():
    if file.suffix in ('.plist', '.xcprivacy'):
        plistlib.loads(file.read_bytes())
fixtures = root / 'mobile' / 'ios' / 'Tests' / 'Fixtures'
for name, digest in json.loads((fixtures / 'sha256.json').read_text()).items():
    assert hashlib.sha256((fixtures / name).read_bytes()).hexdigest() == digest, name
if errors:
    print('\n'.join(errors)); sys.exit(1)
print(f'{len(files)} Swift files: syntax trees parsed; plist and fixture hashes valid. Xcode compile NOT performed.')
