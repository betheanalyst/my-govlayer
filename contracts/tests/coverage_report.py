"""Line coverage of the two contracts, using only the standard library.

    python tests/coverage_report.py                 # print a report
    python tests/coverage_report.py --fail-under 95 # exit 1 if total < 95%
    python tests/coverage_report.py --show-missing  # list uncovered line numbers

Counts executable lines (as the compiler sees them) of govlayercore.py and
govlayeradmin.py that ran at least once while the whole suite executed."""
import argparse
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGETS = [os.path.join(ROOT, "govlayercore.py"), os.path.join(ROOT, "govlayeradmin.py")]
hits = {t: set() for t in TARGETS}


def tracer(frame, event, arg):
    path = frame.f_code.co_filename
    if path in hits:
        if event == "line":
            hits[path].add(frame.f_lineno)
        return tracer
    return None


def executable_lines(path):
    code = compile(open(path).read(), path, "exec")
    lines, stack = set(), [code]
    while stack:
        c = stack.pop()
        lines.update(ln for _, _, ln in c.co_lines() if ln)
        stack.extend(k for k in c.co_consts if hasattr(k, "co_code"))
    return lines


def ranges(nums):
    out, nums = [], sorted(nums)
    i = 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] <= nums[j] + 2:     # tolerate blank/comment gaps
            j += 1
        out.append(str(nums[i]) if i == j else f"{nums[i]}-{nums[j]}")
        i = j + 1
    return ", ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fail-under", type=float, default=0)
    ap.add_argument("--show-missing", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, HERE)
    sys.settrace(tracer)
    suite = unittest.defaultTestLoader.discover(HERE, top_level_dir=HERE)
    result = unittest.TextTestRunner(verbosity=0, stream=open(os.devnull, "w")).run(suite)
    sys.settrace(None)

    tot_c = tot_n = 0
    print(f"\n{'file':<22}{'lines':>7}{'hit':>7}{'cover':>9}")
    for t in TARGETS:
        ex = executable_lines(t)
        got = hits[t] & ex
        tot_c += len(got)
        tot_n += len(ex)
        print(f"{os.path.basename(t):<22}{len(ex):>7}{len(got):>7}{100 * len(got) / len(ex):>8.1f}%")
        if args.show_missing and ex - got:
            print("   missing:", ranges(ex - got))
    pct = 100 * tot_c / tot_n
    print(f"{'TOTAL':<22}{tot_n:>7}{tot_c:>7}{pct:>8.1f}%   (tests run: {result.testsRun}, failures: "
          f"{len(result.failures) + len(result.errors)})")
    if not result.wasSuccessful():
        sys.exit(1)
    if pct < args.fail_under:
        print(f"coverage {pct:.1f}% is below the required {args.fail_under}%")
        sys.exit(1)


if __name__ == "__main__":
    main()
