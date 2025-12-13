import gdstk
import argparse
import sys


def inspect_gds(gds_file, log_file=None):
    """
    Inspect a GDS file and print its structure.

    Args:
        gds_file: Path to the GDS file to read
        log_file: Optional path to log file. If None, prints to stdout
    """
    # Set up output
    if log_file:
        output = open(log_file, 'w')
    else:
        output = sys.stdout

    try:
        library = gdstk.read_gds(gds_file)

        # Inspect structure
        print(f"Library: {library.name}", file=output)
        print(f"Number of cells: {len(library.cells)}", file=output)
        print(f"Cells: {[cell.name for cell in library.cells]}", file=output)
        print("", file=output)

        for cell in library.cells:
            print(f"Cell: {cell.name}", file=output)
            print(f"  Polygons: {len(cell.polygons)}", file=output)
            print(f"  Paths: {len(cell.paths)}", file=output)
            print(f"  Labels: {len(cell.labels)}", file=output)
            print(f"  References: {len(cell.references)}", file=output)

            for poly in cell.polygons:
                print(f"    Polygon - Layer {poly.layer}, datatype {poly.datatype}", file=output)
                print(f"      Points: {poly.points}", file=output)

            for path in cell.paths:
                # Handle both RobustPath and FlexPath which have different attributes
                if hasattr(path, 'layers'):
                    # FlexPath has layers (list) and datatypes (list)
                    print(f"    Path - Layers {path.layers}, datatypes {path.datatypes}", file=output)
                else:
                    # RobustPath has layer and datatype
                    print(f"    Path - Layer {path.layer}, datatype {path.datatype}", file=output)

                if hasattr(path, 'spine'):
                    print(f"      Spine points: {path.spine()}", file=output)
                elif hasattr(path, 'points'):
                    print(f"      Points: {path.points}", file=output)

            for label in cell.labels:
                print(f"    Label - Layer {label.layer}, texttype {label.texttype}", file=output)
                print(f"      Text: {label.text}, Origin: {label.origin}", file=output)

            for ref in cell.references:
                if hasattr(ref, 'cell'):
                    print(f"    Reference to cell: {ref.cell.name if ref.cell else 'Unknown'}", file=output)
                print(f"      Origin: {ref.origin}", file=output)
                print(f"      Rotation: {ref.rotation} degrees", file=output)
                print(f"      Magnification: {ref.magnification}", file=output)
                print(f"      X-reflection: {ref.x_reflection}", file=output)
                if hasattr(ref, 'columns') and ref.columns > 1:
                    print(f"      Array: {ref.columns} columns x {ref.rows} rows", file=output)
                    print(f"      Spacing: {ref.spacing}", file=output)

            print("", file=output)

    finally:
        if log_file and output != sys.stdout:
            output.close()


def main():
    parser = argparse.ArgumentParser(
        description='Inspect GDS file structure and print detailed information'
    )
    parser.add_argument(
        'gds_file',
        help='Path to the GDS file to read'
    )
    parser.add_argument(
        '-o', '--output',
        dest='log_file',
        help='Path to log file (default: print to stdout)',
        default=None
    )

    args = parser.parse_args()

    inspect_gds(args.gds_file, args.log_file)


if __name__ == '__main__':
    main()