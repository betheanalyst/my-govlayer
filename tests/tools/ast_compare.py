"""Prove that two versions of a Python file differ only in comments and docstrings.

    python tests/tools/ast_compare.py <old.py> <new.py>

Comments never reach the syntax tree. Docstrings are removed here before
comparing, so any other difference (logic, constants, error messages, names,
decorators, annotations) is reported and the exit status is 1."""
import ast
import sys


def strip_docstrings(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    return tree


def normalized(path):
    return ast.dump(strip_docstrings(ast.parse(open(path).read())), include_attributes=False)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    old, new = normalized(sys.argv[1]), normalized(sys.argv[2])
    if old == new:
        print(f"IDENTICAL code: {sys.argv[2]} differs from {sys.argv[1]} only in comments/docstrings")
        return
    print(f"DIFFERENT code between {sys.argv[1]} and {sys.argv[2]}")
    sys.exit(1)


if __name__ == "__main__":
    main()
