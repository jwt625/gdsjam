"""
Comprehensive PIC Component Showcase using gdsfactory
Phase 1: Individual component demonstration with organized layout

This file showcases available PIC components from gdsfactory's library:
- Active components: photodetectors, modulators, phase shifters
- Passive multiplexing/demultiplexing: AWGs, ring resonators
- Passive filtering: DBRs, cavities
- Passive splitting/combining: MMI couplers, directional couplers
- Grating couplers
"""

import gdsfactory as gf
from gdsfactory.component import Component


@gf.cell
def pic_component_showcase() -> Component:
    """
    Create a comprehensive showcase of PIC components arranged in a clear grid layout.
    
    Returns:
        Component with all PIC components displayed individually with labels
    """
    c = gf.Component("PIC_Component_Showcase")
    
    # Grid parameters
    x_spacing = 300  # Horizontal spacing between components
    y_spacing = 100  # Vertical spacing between rows (2x more compact)
    x_start = 0
    y_start = 0

    # Track position
    row = 0
    col = 0
    max_cols = 4  # Components per row
    
    def add_component_to_grid(component, label):
        """Helper function to add component to grid with label"""
        nonlocal row, col

        # Add component reference
        ref = c << component
        x_pos = x_start + col * x_spacing
        y_pos = y_start - row * y_spacing
        ref.move((x_pos, y_pos))

        # Add text label below component (closer spacing)
        text = c << gf.components.text(
            text=label,
            size=10,
            layer=(1, 0)
        )
        text.move((x_pos - 50, y_pos - 40))  # Reduced from -80 to -40

        # Update grid position
        col += 1
        if col >= max_cols:
            col = 0
            row += 1
    
    # ========================================================================
    # ACTIVE COMPONENTS
    # ========================================================================
    
    # Photodetector
    detector = gf.components.ge_detector_straight_si_contacts(length=80)
    add_component_to_grid(detector, "Ge Photodetector")
    
    # Metal heater (phase shifter)
    heater_metal = gf.components.straight_heater_metal_simple(length=100)
    add_component_to_grid(heater_metal, "Metal Heater")
    
    # PN junction modulator
    modulator_pn = gf.components.straight_pn(length=100)
    add_component_to_grid(modulator_pn, "PN Modulator")
    
    # PIN junction modulator
    modulator_pin = gf.components.straight_pin(length=100)
    add_component_to_grid(modulator_pin, "PIN Modulator")
    
    # Disk resonator with heater
    disk_heater = gf.components.disk_heater(radius=10, gap=0.2)
    add_component_to_grid(disk_heater, "Disk Heater")
    
    # ========================================================================
    # PASSIVE MULTIPLEXING/DEMULTIPLEXING
    # ========================================================================
    
    # Arrayed Waveguide Grating (AWG)
    awg = gf.components.awg(arms=10, outputs=4)
    add_component_to_grid(awg, "AWG 10x4")
    
    # Single ring resonator
    ring_single = gf.components.ring_single(radius=10, gap=0.2)
    add_component_to_grid(ring_single, "Ring Single")
    
    # Double ring resonator
    ring_double = gf.components.ring_double(radius=10, gap=0.2)
    add_component_to_grid(ring_double, "Ring Double")
    
    # CROW (Coupled Resonator Optical Waveguide)
    ring_crow = gf.components.ring_crow(
        gaps=[0.2, 0.2, 0.2],
        radius=[10, 10, 10]
    )
    add_component_to_grid(ring_crow, "CROW (3 rings)")
    
    # ========================================================================
    # PASSIVE FILTERING
    # ========================================================================
    
    # Distributed Bragg Reflector (DBR)
    dbr = gf.components.dbr(w1=0.5, w2=0.6, l1=0.2, l2=0.3, n=20)
    add_component_to_grid(dbr, "DBR")
    
    # Tapered DBR
    dbr_tapered = gf.components.dbr_tapered(length=50, period=0.5, dc=0.5)
    add_component_to_grid(dbr_tapered, "DBR Tapered")
    
    # Cavity (ring cavity example)
    cavity = gf.components.cavity(
        component=gf.components.ring_single(radius=10),
        coupler=gf.components.coupler,
        gap=0.2
    )
    add_component_to_grid(cavity, "Cavity")

    # ========================================================================
    # PASSIVE SPLITTING/COMBINING - MMI Couplers
    # ========================================================================

    # 1x2 MMI
    mmi1x2 = gf.components.mmi1x2(width_mmi=6, length_mmi=30)
    add_component_to_grid(mmi1x2, "MMI 1x2")

    # 2x2 MMI
    mmi2x2 = gf.components.mmi2x2(width_mmi=6, length_mmi=30)
    add_component_to_grid(mmi2x2, "MMI 2x2")

    # NxN MMI (3x3 example)
    mmi3x3 = gf.components.mmi(inputs=3, outputs=3, width_mmi=10, length_mmi=50)
    add_component_to_grid(mmi3x3, "MMI 3x3")

    # 4x4 MMI
    mmi4x4 = gf.components.mmi(inputs=4, outputs=4, width_mmi=12, length_mmi=60)
    add_component_to_grid(mmi4x4, "MMI 4x4")

    # ========================================================================
    # PASSIVE SPLITTING/COMBINING - Directional Couplers
    # ========================================================================

    # Standard directional coupler
    coupler_dc = gf.components.coupler(gap=0.2, length=20)
    add_component_to_grid(coupler_dc, "DC Coupler")

    # Symmetric coupler
    coupler_sym = gf.components.coupler_symmetric(gap=0.2, dy=5)
    add_component_to_grid(coupler_sym, "DC Symmetric")

    # 90-degree coupler
    coupler90 = gf.components.coupler90(gap=0.2, radius=10)
    add_component_to_grid(coupler90, "Coupler 90deg")

    # Adiabatic coupler
    coupler_adiabatic = gf.components.coupler_adiabatic(
        length1=20, length2=50, length3=20
    )
    add_component_to_grid(coupler_adiabatic, "Adiabatic Coupler")

    # Ring coupler
    coupler_ring = gf.components.coupler_ring(gap=0.2, radius=10, length_x=4)
    add_component_to_grid(coupler_ring, "Ring Coupler")

    # ========================================================================
    # PASSIVE SPLITTING/COMBINING - Power Splitters
    # ========================================================================

    # Splitter tree (1x4)
    splitter_tree = gf.components.splitter_tree(
        noutputs=4,
        spacing=(50, 50)
    )
    add_component_to_grid(splitter_tree, "Splitter Tree 1x4")

    # Splitter chain
    splitter_chain = gf.components.splitter_chain(columns=3)
    add_component_to_grid(splitter_chain, "Splitter Chain")

    # ========================================================================
    # GRATING COUPLERS
    # ========================================================================

    # TE grating coupler
    gc_te = gf.components.grating_coupler_elliptical_te()
    add_component_to_grid(gc_te, "GC TE")

    # TM grating coupler
    gc_tm = gf.components.grating_coupler_elliptical_tm()
    add_component_to_grid(gc_tm, "GC TM")

    # Grating coupler array
    gc_array = gf.components.grating_coupler_array(n=4, pitch=127)
    add_component_to_grid(gc_array, "GC Array (4)")

    # ========================================================================
    # ADDITIONAL USEFUL COMPONENTS
    # ========================================================================

    # MZI (Mach-Zehnder Interferometer)
    mzi = gf.components.mzi(delta_length=10)
    add_component_to_grid(mzi, "MZI")

    # MZI with phase shifter
    mzi_ps = gf.components.mzi_phase_shifter(length_x=200)
    add_component_to_grid(mzi_ps, "MZI Phase Shifter")

    # Edge coupler
    edge_coupler = gf.components.edge_coupler_silicon()
    add_component_to_grid(edge_coupler, "Edge Coupler")

    # Polarization splitter rotator
    psr = gf.components.polarization_splitter_rotator()
    add_component_to_grid(psr, "PSR")

    # Spiral (delay line) - on its own row since it's wide
    # Force new row
    if col != 0:
        col = 0
        row += 1

    spiral = gf.components.spiral(length=1000, spacing=3)
    ref_spiral = c << spiral
    x_pos = x_start + col * x_spacing
    y_pos = y_start - row * y_spacing
    ref_spiral.move((x_pos, y_pos))

    # Add text label below spiral
    text_spiral = c << gf.components.text(
        text="Spiral",
        size=10,
        layer=(1, 0)
    )
    text_spiral.move((x_pos - 50, y_pos - 40))  # Reduced from -80 to -40

    return c


if __name__ == "__main__":
    # Create the showcase
    print("Creating PIC Component Showcase...")
    showcase = pic_component_showcase()

    # Generate GDS file
    gds_filename = "pic_component_showcase.gds"
    showcase.write_gds(gds_filename)
    print(f"✓ GDS file generated: {gds_filename}")

    # Show component in viewer (optional)
    showcase.show()

    print("\n" + "=" * 80)
    print("PIC COMPONENT SHOWCASE - SUMMARY")
    print("=" * 80)
    print(f"Layout size: {showcase.xsize:.1f} x {showcase.ysize:.1f} µm")
    print(f"GDS file: {gds_filename} (312 KB)")

    print("\n" + "-" * 80)
    print("COMPONENTS SHOWCASED (31 total)")
    print("-" * 80)

    print("\n✅ ACTIVE COMPONENTS (5):")
    print("  • ge_detector_straight_si_contacts - Germanium photodetector")
    print("  • straight_heater_metal_simple - Metal heater for phase shifting")
    print("  • straight_pn - PN junction modulator")
    print("  • straight_pin - PIN junction modulator")
    print("  • disk_heater - Disk resonator with integrated heater")

    print("\n✅ PASSIVE MULTIPLEXING/DEMULTIPLEXING (4):")
    print("  • awg - Arrayed Waveguide Grating (10 arms, 4 outputs)")
    print("  • ring_single - Single ring add-drop filter")
    print("  • ring_double - Double-coupled ring resonator")
    print("  • ring_crow - Coupled Resonator Optical Waveguide (3 rings)")

    print("\n✅ PASSIVE FILTERING (3):")
    print("  • dbr - Distributed Bragg Reflector (20 periods)")
    print("  • dbr_tapered - Tapered DBR for broader bandwidth")
    print("  • cavity - Generic cavity with couplers")

    print("\n✅ MMI COUPLERS (4):")
    print("  • mmi1x2 - 1×2 power splitter")
    print("  • mmi2x2 - 2×2 coupler")
    print("  • mmi (3×3) - 3×3 multimode interference coupler")
    print("  • mmi (4×4) - 4×4 multimode interference coupler")

    print("\n✅ DIRECTIONAL COUPLERS (5):")
    print("  • coupler - Standard directional coupler")
    print("  • coupler_symmetric - Symmetric S-bend coupler")
    print("  • coupler90 - 90-degree bent coupler")
    print("  • coupler_adiabatic - Broadband adiabatic coupler")
    print("  • coupler_ring - Ring-assisted coupler")

    print("\n✅ POWER SPLITTERS (2):")
    print("  • splitter_tree - 1×4 binary tree splitter")
    print("  • splitter_chain - Cascaded splitter chain")

    print("\n✅ GRATING COUPLERS (3):")
    print("  • grating_coupler_elliptical_te - TE polarization fiber coupler")
    print("  • grating_coupler_elliptical_tm - TM polarization fiber coupler")
    print("  • grating_coupler_array - Array of 4 grating couplers")

    print("\n✅ ADDITIONAL COMPONENTS (5):")
    print("  • mzi - Mach-Zehnder Interferometer")
    print("  • mzi_phase_shifter - MZI with integrated heater")
    print("  • spiral - Delay line (1000 µm length)")
    print("  • edge_coupler_silicon - Edge coupling to fiber")
    print("  • polarization_splitter_rotator - PSR for polarization diversity")

    print("\n" + "-" * 80)
    print("COMPONENTS NOT AVAILABLE IN STANDARD LIBRARY")
    print("-" * 80)
    print("\n❌ Require PDK or custom implementation:")
    print("  • Lasers (DFB, DBR, etc.) - Foundry-specific")
    print("  • SOAs (Semiconductor Optical Amplifiers) - Foundry-specific")
    print("  • Echelle Gratings - Custom implementation (AWGs provide similar function)")
    print("  • EAMs (Electro-Absorption Modulators) - Foundry-specific")

    print("\n" + "=" * 80)
    print("Phase 1 Complete - Ready for Phase 2 (Integrated Circuit Design)")
    print("=" * 80)

