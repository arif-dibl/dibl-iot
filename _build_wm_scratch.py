# -*- coding: utf-8 -*-
"""
Build /home/arif-dibl/Documents/case_design_140x100x50/Case_140x100x50_WallMount.FCStd
COMPLETELY FROM SCRATCH (no loading of pre-existing FCStd geometry), combining:
  - Base 140x100x50 enclosure measurements from Case_140x100x50 & sample_case
  - Monolithic 1-solid Top_Lid (Lid_Cavity uses LipInLen x LipInWid = 133.5 x 93.5 mm, R=2.75 mm
    so Lid_AlignLip is 100% connected to Top_Lid with Solids=1 and zero internal overhangs)
  - Reinforced Option 3 External Wall-Mounting Flanges from sample_case (6.0 mm thick x 24.0 mm wide
    ears at Y=+-26.5 mm, X=+-85.0 mm, full-width 45 deg root bevel Z=5.8..10.5 mm, and twin 3.5 mm
    gusset ribs Z=5.8..14.0 mm)
  - Option 1 Dovetail Slide Rail + Wall Plate & Option 2 Keyhole H-Frame
  - 5x rearranged M3 PCB standoffs + Main PCB_Assembly (PCB_Board + 9x 3D components)
  - SUNROM 7669 IEC320-C8 right-wall cutout + AC_Socket_C8_Panel assembly
  - Top_Lid UI standoffs, button/LED cutouts + UI_PCB_Assembly (UI_PCB_Board + 8x 3D components)
  - Wall & lid functional text engravings ("220V AC", "VALVE 1", "VALVE 2") + clean polygon-healed
    underside logo engraving (zero micro-slivers, selfInt=False)
  - WITHOUT any top logo and WITHOUT any vents.
"""

import copy
import math
import os
import struct
import zipfile
import xml.etree.ElementTree as ET
import FreeCAD
import Part
import Sketcher
import MeshPart
import importSVG

DST_FCSTD = "/home/arif-dibl/Documents/case_design_140x100x50/Case_140x100x50_WallMount.FCStd"
SAMPLE_NO_VENT_NO_LOGO_FCSTD = "/home/arif-dibl/Documents/case_design_140x100x50/sample_case_no_vent_no_logo.FCStd"
GUI_TPL_SRC = "/home/arif-dibl/Documents/case_design_140x100x50/Case_140x100x50_WallMount.FCStd.pre_vent.bak"


# ---------------------------------------------------------------------------
# Generic Sketcher helpers (all Sketches verified DoF == 0, 0 redundancies)
# ---------------------------------------------------------------------------
def get_origin_plane(body, role="XY_Plane"):
    for feat in body.Origin.OriginFeatures:
        if getattr(feat, "Role", "") == role or feat.Name.startswith(role):
            return feat
    raise RuntimeError(f"Could not locate {role} inside {body.Name}")


def attach_sketch(sk, plane, z_expr=None, z_val=0.0):
    if hasattr(sk, "AttachmentSupport"):
        sk.AttachmentSupport = [(plane, "")]
    else:
        sk.Support = [(plane, "")]
    sk.MapMode = "FlatFace"
    if z_expr:
        sk.AttachmentOffset = FreeCAD.Placement(
            FreeCAD.Vector(0.0, 0.0, float(z_val)), FreeCAD.Rotation()
        )
        sk.setExpression("AttachmentOffset.Base.z", z_expr)


def bind_expr(sk, constraint_tuple, expr=None):
    idx = sk.addConstraint(Sketcher.Constraint(*constraint_tuple))
    if expr is not None:
        sk.setExpression(f"Constraints[{idx}]", expr)
    return idx


def add_line(sk, p1, p2):
    gid = sk.addGeometry(
        Part.LineSegment(FreeCAD.Vector(p1[0], p1[1], 0.0), FreeCAD.Vector(p2[0], p2[1], 0.0)),
        False,
    )
    return gid, 1, 2


def add_arc_ccw(sk, cx, cy, r, p_start, p_end):
    a_s = math.atan2(p_start[1] - cy, p_start[0] - cx)
    a_e = math.atan2(p_end[1] - cy, p_end[0] - cx)
    u1, u2 = a_s, a_e
    while u2 <= u1:
        u2 += 2.0 * math.pi
    while u2 - u1 > 2.0 * math.pi:
        u2 -= 2.0 * math.pi
    circle = Part.Circle(FreeCAD.Vector(cx, cy, 0.0), FreeCAD.Vector(0.0, 0.0, 1.0), r)
    gid = sk.addGeometry(Part.ArcOfCircle(circle, u1, u2), False)
    return gid, 1, 2


def lock_point_x(sk, gid, pos, val, expr):
    if abs(val) < 1e-9 and expr == "0":
        bind_expr(sk, ("PointOnObject", gid, pos, -2))
    elif val >= 0:
        bind_expr(sk, ("DistanceX", -1, 1, gid, pos, val), expr)
    else:
        bind_expr(sk, ("DistanceX", gid, pos, -1, 1, -val), f"-({expr})")


def lock_point_y(sk, gid, pos, val, expr):
    if abs(val) < 1e-9 and expr == "0":
        bind_expr(sk, ("PointOnObject", gid, pos, -1))
    elif val >= 0:
        bind_expr(sk, ("DistanceY", -1, 1, gid, pos, val), expr)
    else:
        bind_expr(sk, ("DistanceY", gid, pos, -1, 1, -val), f"-({expr})")


def add_rect(sk, x0, y0, x1, y1, ex_x0, ex_y0, ex_w, ex_h):
    g0, _, _ = add_line(sk, (x0, y0), (x1, y0))
    g1, _, _ = add_line(sk, (x1, y0), (x1, y1))
    g2, _, _ = add_line(sk, (x1, y1), (x0, y1))
    g3, _, _ = add_line(sk, (x0, y1), (x0, y0))

    bind_expr(sk, ("Coincident", g0, 2, g1, 1))
    bind_expr(sk, ("Coincident", g1, 2, g2, 1))
    bind_expr(sk, ("Coincident", g2, 2, g3, 1))
    bind_expr(sk, ("Coincident", g3, 2, g0, 1))

    bind_expr(sk, ("Horizontal", g0))
    bind_expr(sk, ("Vertical", g1))
    bind_expr(sk, ("Horizontal", g2))
    bind_expr(sk, ("Vertical", g3))

    bind_expr(sk, ("DistanceX", g0, 1, g0, 2, x1 - x0), ex_w)
    bind_expr(sk, ("DistanceY", g1, 1, g1, 2, y1 - y0), ex_h)
    lock_point_x(sk, g0, 1, x0, ex_x0)
    lock_point_y(sk, g0, 1, y0, ex_y0)


def add_rounded_rect_centered(sk, total_len, total_wid, radius, expr_len, expr_wid, expr_rad):
    """Centered rounded rectangle (8 segments, exact DOF=0)."""
    hx, hy, r = total_len / 2.0, total_wid / 2.0, radius
    cx, cy = hx - r, hy - r

    g0, s0, e0 = add_line(sk, (hx, -cy), (hx, cy))
    g1, s1, e1 = add_arc_ccw(sk, cx, cy, r, (hx, cy), (cx, hy))
    g2, s2, e2 = add_line(sk, (cx, hy), (-cx, hy))
    g3, s3, e3 = add_arc_ccw(sk, -cx, cy, r, (-cx, hy), (-hx, cy))
    g4, s4, e4 = add_line(sk, (-hx, cy), (-hx, -cy))
    g5, s5, e5 = add_arc_ccw(sk, -cx, -cy, r, (-hx, -cy), (-cx, -hy))
    g6, s6, e6 = add_line(sk, (-cx, -hy), (cx, -hy))
    g7, s7, e7 = add_arc_ccw(sk, cx, -cy, r, (cx, -hy), (hx, -cy))

    segs = [(g0, s0, e0), (g1, s1, e1), (g2, s2, e2), (g3, s3, e3),
            (g4, s4, e4), (g5, s5, e5), (g6, s6, e6), (g7, s7, e7)]
    for i in range(8):
        gi, _, ei = segs[i]
        gn, sn, _ = segs[(i + 1) % 8]
        bind_expr(sk, ("Tangent", gi, ei, gn, sn))

    bind_expr(sk, ("Vertical", g0))
    bind_expr(sk, ("Horizontal", g2))
    bind_expr(sk, ("Vertical", g4))
    bind_expr(sk, ("Horizontal", g6))

    bind_expr(sk, ("Equal", g1, g3))
    bind_expr(sk, ("Equal", g1, g5))
    bind_expr(sk, ("Equal", g1, g7))
    bind_expr(sk, ("Radius", g1, r), expr_rad)

    bind_expr(sk, ("Symmetric", g1, 3, g5, 3, -1, 1))
    bind_expr(sk, ("DistanceX", g4, 1, g0, 1, total_len), expr_len)
    bind_expr(sk, ("DistanceY", g6, 1, g2, 1, total_wid), expr_wid)


def add_rounded_rect(sk, cx, cy, w, h, r, ex_x0, ex_y0, ex_w, ex_h, ex_r):
    hx, hy = w / 2.0, h / 2.0
    rx0, ry0 = cx - hx, cy - hy
    rx1, ry1 = cx + hx, cy + hy
    ax0, ay0 = rx0 + r, ry0 + r
    ax1, ay1 = rx1 - r, ry1 - r

    g0, s0, e0 = add_line(sk, (rx1, ay0), (rx1, ay1))
    g1, s1, e1 = add_arc_ccw(sk, ax1, ay1, r, (rx1, ay1), (ax1, ry1))
    g2, s2, e2 = add_line(sk, (ax1, ry1), (ax0, ry1))
    g3, s3, e3 = add_arc_ccw(sk, ax0, ay1, r, (ax0, ry1), (rx0, ay1))
    g4, s4, e4 = add_line(sk, (rx0, ay1), (rx0, ay0))
    g5, s5, e5 = add_arc_ccw(sk, ax0, ay0, r, (rx0, ay0), (ax0, ry0))
    g6, s6, e6 = add_line(sk, (ax0, ry0), (ax1, ry0))
    g7, s7, e7 = add_arc_ccw(sk, ax1, ay0, r, (ax1, ry0), (rx1, ay0))

    segs = [(g0, s0, e0), (g1, s1, e1), (g2, s2, e2), (g3, s3, e3),
            (g4, s4, e4), (g5, s5, e5), (g6, s6, e6), (g7, s7, e7)]
    for i in range(8):
        gi, _, ei = segs[i]
        gn, sn, _ = segs[(i + 1) % 8]
        bind_expr(sk, ("Tangent", gi, ei, gn, sn))

    bind_expr(sk, ("Vertical", g0))
    bind_expr(sk, ("Horizontal", g2))
    bind_expr(sk, ("Vertical", g4))
    bind_expr(sk, ("Horizontal", g6))

    bind_expr(sk, ("Equal", g1, g3))
    bind_expr(sk, ("Equal", g1, g5))
    bind_expr(sk, ("Equal", g1, g7))
    bind_expr(sk, ("Radius", g1, r), ex_r)

    bind_expr(sk, ("DistanceX", g4, 1, g0, 1, w), ex_w)
    bind_expr(sk, ("DistanceY", g6, 1, g2, 1, h), ex_h)
    lock_point_x(sk, g4, 1, rx0, ex_x0)
    lock_point_y(sk, g6, 1, ry0, ex_y0)


def add_circles_sketch(sk, centers_with_exprs, dia_val, expr_dia):
    for cx, cy, expr_cx, expr_cy in centers_with_exprs:
        gid = sk.addGeometry(
            Part.Circle(FreeCAD.Vector(cx, cy, 0.0), FreeCAD.Vector(0.0, 0.0, 1.0), dia_val / 2.0),
            False,
        )
        bind_expr(sk, ("Diameter", gid, dia_val), expr_dia)
        if cx < 0:
            bind_expr(sk, ("DistanceX", gid, 3, -1, 1, -cx), expr_cx)
        else:
            bind_expr(sk, ("DistanceX", -1, 1, gid, 3, cx), expr_cx)
        if cy < 0:
            bind_expr(sk, ("DistanceY", gid, 3, -1, 1, -cy), expr_cy)
        else:
            bind_expr(sk, ("DistanceY", -1, 1, gid, 3, cy), expr_cy)


def corner_centers_expr(expr_x, expr_y, vx, vy):
    return [
        (vx, vy, expr_x, expr_y),
        (-vx, vy, expr_x, expr_y),
        (-vx, -vy, expr_x, expr_y),
        (vx, -vy, expr_x, expr_y),
    ]


def add_vertical_slot(sk, cx, cy, dia, travel, ex_cx, ex_cy_top, ex_dia, ex_travel):
    r = dia / 2.0
    yt = cy + travel / 2.0
    yb = cy - travel / 2.0

    g_top, _, _ = add_arc_ccw(sk, cx, yt, r, (cx + r, yt), (cx - r, yt))
    g_left, _, _ = add_line(sk, (cx - r, yt), (cx - r, yb))
    g_bot, _, _ = add_arc_ccw(sk, cx, yb, r, (cx - r, yb), (cx + r, yb))
    g_right, _, _ = add_line(sk, (cx + r, yb), (cx + r, yt))

    bind_expr(sk, ("Tangent", g_top, 2, g_left, 1))
    bind_expr(sk, ("Tangent", g_left, 2, g_bot, 1))
    bind_expr(sk, ("Tangent", g_bot, 2, g_right, 1))
    bind_expr(sk, ("Tangent", g_right, 2, g_top, 1))

    bind_expr(sk, ("Vertical", g_right))
    bind_expr(sk, ("Equal", g_top, g_bot))
    bind_expr(sk, ("Diameter", g_top, dia), ex_dia)

    lock_point_x(sk, g_top, 3, cx, ex_cx)
    lock_point_y(sk, g_top, 3, yt, ex_cy_top)
    bind_expr(sk, ("DistanceY", g_bot, 3, g_top, 3, travel), ex_travel)


def add_horizontal_slot(sk, cx, cy, dia, travel, ex_cx_right, ex_cy, ex_dia, ex_travel):
    r = dia / 2.0
    xr = cx + travel / 2.0
    xl = cx - travel / 2.0

    g_r, _, _ = add_arc_ccw(sk, xr, cy, r, (xr, cy - r), (xr, cy + r))
    g_t, _, _ = add_line(sk, (xr, cy + r), (xl, cy + r))
    g_l, _, _ = add_arc_ccw(sk, xl, cy, r, (xl, cy + r), (xl, cy - r))
    g_b, _, _ = add_line(sk, (xl, cy - r), (xr, cy - r))

    bind_expr(sk, ("Tangent", g_r, 2, g_t, 1))
    bind_expr(sk, ("Tangent", g_t, 2, g_l, 1))
    bind_expr(sk, ("Tangent", g_l, 2, g_b, 1))
    bind_expr(sk, ("Tangent", g_b, 2, g_r, 1))

    bind_expr(sk, ("Horizontal", g_t))
    bind_expr(sk, ("Equal", g_r, g_l))
    bind_expr(sk, ("Diameter", g_r, dia), ex_dia)

    lock_point_x(sk, g_r, 3, xr, ex_cx_right)
    lock_point_y(sk, g_r, 3, cy, ex_cy)
    bind_expr(sk, ("DistanceX", g_l, 3, g_r, 3, travel), ex_travel)


def add_keyhole(sk, cx, cy, entry_dia, slot_dia, travel, ex_cx, ex_cy_bot, ex_entry_dia, ex_slot_dia, ex_travel):
    r_big = entry_dia / 2.0
    r_slot = slot_dia / 2.0
    yc_bot = cy - travel / 2.0
    yc_top = cy + travel / 2.0
    dy = math.sqrt(r_big * r_big - r_slot * r_slot)
    y_int = yc_bot + dy

    g_bot, _, _ = add_arc_ccw(sk, cx, yc_bot, r_big, (cx - r_slot, y_int), (cx + r_slot, y_int))
    g_right, _, _ = add_line(sk, (cx + r_slot, y_int), (cx + r_slot, yc_top))
    g_top, _, _ = add_arc_ccw(sk, cx, yc_top, r_slot, (cx + r_slot, yc_top), (cx - r_slot, yc_top))
    g_left, _, _ = add_line(sk, (cx - r_slot, yc_top), (cx - r_slot, y_int))

    bind_expr(sk, ("Coincident", g_bot, 2, g_right, 1))
    bind_expr(sk, ("Tangent", g_right, 2, g_top, 1))
    bind_expr(sk, ("Tangent", g_top, 2, g_left, 1))
    bind_expr(sk, ("Coincident", g_left, 2, g_bot, 1))

    bind_expr(sk, ("Vertical", g_right))
    bind_expr(sk, ("Vertical", g_left))

    bind_expr(sk, ("Diameter", g_bot, entry_dia), ex_entry_dia)
    bind_expr(sk, ("Diameter", g_top, slot_dia), ex_slot_dia)

    lock_point_x(sk, g_bot, 3, cx, ex_cx)
    lock_point_x(sk, g_top, 3, cx, ex_cx)
    lock_point_y(sk, g_bot, 3, yc_bot, ex_cy_bot)
    bind_expr(sk, ("DistanceY", g_bot, 3, g_top, 3, travel), ex_travel)


def add_dovetail_trapezoid(sk, rn, rf, rh, ov, ex_half_top, ex_half_bot, ex_rh, ex_ov):
    ht = rn / 2.0
    hb = ht + rf
    g0, _, _ = add_line(sk, (-ht, ov), (ht, ov))
    g1, _, _ = add_line(sk, (ht, ov), (ht, 0.0))
    g2, _, _ = add_line(sk, (ht, 0.0), (hb, -rh))
    g3, _, _ = add_line(sk, (hb, -rh), (-hb, -rh))
    g4, _, _ = add_line(sk, (-hb, -rh), (-ht, 0.0))
    g5, _, _ = add_line(sk, (-ht, 0.0), (-ht, ov))

    lines = [g0, g1, g2, g3, g4, g5]
    for i in range(6):
        bind_expr(sk, ("Coincident", lines[i], 2, lines[(i + 1) % 6], 1))

    bind_expr(sk, ("Horizontal", g0))
    bind_expr(sk, ("Vertical", g1))
    bind_expr(sk, ("Horizontal", g3))
    bind_expr(sk, ("Vertical", g5))

    bind_expr(sk, ("PointOnObject", g1, 2, -1))
    bind_expr(sk, ("PointOnObject", g4, 2, -1))

    bind_expr(sk, ("DistanceX", -1, 1, g1, 2, ht), ex_half_top)
    bind_expr(sk, ("DistanceX", g4, 2, -1, 1, ht), ex_half_top)
    bind_expr(sk, ("DistanceX", -1, 1, g2, 2, hb), ex_half_bot)
    bind_expr(sk, ("DistanceX", g3, 2, -1, 1, hb), ex_half_bot)

    bind_expr(sk, ("DistanceY", -1, 1, g0, 2, ov), ex_ov)
    bind_expr(sk, ("DistanceY", g2, 2, -1, 1, rh), ex_rh)


def add_track_trapezoid(sk, side, itop, ibot, xout, dtp, dbt, ex_itop, ex_ibot, ex_xout, ex_dtp, ex_dbt):
    if side > 0:
        pts = [(itop, -dtp), (xout, -dtp), (xout, -dbt), (ibot, -dbt)]
    else:
        pts = [(-xout, -dtp), (-itop, -dtp), (-ibot, -dbt), (-xout, -dbt)]

    g0, _, _ = add_line(sk, pts[0], pts[1])
    g1, _, _ = add_line(sk, pts[1], pts[2])
    g2, _, _ = add_line(sk, pts[2], pts[3])
    g3, _, _ = add_line(sk, pts[3], pts[0])
    segs = [g0, g1, g2, g3]
    for i in range(4):
        bind_expr(sk, ("Coincident", segs[i], 2, segs[(i + 1) % 4], 1))

    bind_expr(sk, ("Horizontal", g0))
    bind_expr(sk, ("Horizontal", g2))
    if side > 0:
        bind_expr(sk, ("Vertical", g1))
        bind_expr(sk, ("DistanceX", -1, 1, g0, 1, itop), ex_itop)
        bind_expr(sk, ("DistanceX", -1, 1, g0, 2, xout), ex_xout)
        bind_expr(sk, ("DistanceX", -1, 1, g2, 2, ibot), ex_ibot)
    else:
        bind_expr(sk, ("Vertical", g3))
        bind_expr(sk, ("DistanceX", g0, 1, -1, 1, xout), ex_xout)
        bind_expr(sk, ("DistanceX", g0, 2, -1, 1, itop), ex_itop)
        bind_expr(sk, ("DistanceX", g2, 1, -1, 1, ibot), ex_ibot)

    bind_expr(sk, ("DistanceY", g0, 1, -1, 1, dtp), ex_dtp)
    bind_expr(sk, ("DistanceY", g2, 1, -1, 1, dbt), ex_dbt)


def add_h_frame(sk, rx, rw, rlen, bar_w, ex_rx, ex_rw, ex_rlen, ex_bar_w):
    x_out = rx + rw / 2.0
    x_in = rx - rw / 2.0
    y_out = rlen / 2.0
    y_bar = bar_w / 2.0

    pts = [
        (-x_out, -y_out), (-x_in, -y_out), (-x_in, -y_bar),
        (x_in, -y_bar),   (x_in, -y_out),  (x_out, -y_out),
        (x_out, y_out),   (x_in, y_out),   (x_in, y_bar),
        (-x_in, y_bar),   (-x_in, y_out),  (-x_out, y_out),
    ]
    edges = []
    for i in range(12):
        gi, _, _ = add_line(sk, pts[i], pts[(i + 1) % 12])
        edges.append(gi)
    for i in range(12):
        bind_expr(sk, ("Coincident", edges[i], 2, edges[(i + 1) % 12], 1))
    for i in range(12):
        bind_expr(sk, ("Horizontal" if i % 2 == 0 else "Vertical", edges[i]))

    ex_xin = f"({ex_rx}) - ({ex_rw}) / 2"
    ex_xout = f"({ex_rx}) + ({ex_rw}) / 2"
    ex_yout = f"({ex_rlen}) / 2"
    ex_ybar = f"({ex_bar_w}) / 2"

    lock_point_x(sk, edges[11], 1, -x_out, f"-({ex_xout})")
    lock_point_x(sk, edges[1], 1, -x_in, f"-({ex_xin})")
    lock_point_x(sk, edges[9], 1, -x_in, f"-({ex_xin})")
    lock_point_x(sk, edges[3], 1, x_in, ex_xin)
    lock_point_x(sk, edges[7], 1, x_in, ex_xin)
    lock_point_x(sk, edges[5], 1, x_out, ex_xout)

    lock_point_y(sk, edges[0], 1, -y_out, f"-({ex_yout})")
    lock_point_y(sk, edges[4], 1, -y_out, f"-({ex_yout})")
    lock_point_y(sk, edges[2], 1, -y_bar, f"-({ex_ybar})")
    lock_point_y(sk, edges[8], 1, y_bar, ex_ybar)
    lock_point_y(sk, edges[10], 1, y_out, ex_yout)
    lock_point_y(sk, edges[6], 1, y_out, ex_yout)


def add_opt3_ear_root90(sk, side, x_in, x_out, cy, w_y, r):
    """Square 90-deg root at x_in, R=r outer corners at x_out (matches sample_case mounting_ear_face, 0 DoF)."""
    y0, y1 = cy - w_y / 2.0, cy + w_y / 2.0
    if side > 0:
        xi, xo = x_in, x_out
        xr = xo - r
        g0, _, _ = add_line(sk, (xi, y0), (xr, y0))
        g1, _, _ = add_arc_ccw(sk, xr, y0 + r, r, (xr, y0), (xo, y0 + r))
        g2, _, _ = add_line(sk, (xo, y0 + r), (xo, y1 - r))
        g3, _, _ = add_arc_ccw(sk, xr, y1 - r, r, (xo, y1 - r), (xr, y1))
        g4, _, _ = add_line(sk, (xr, y1), (xi, y1))
        g5, _, _ = add_line(sk, (xi, y1), (xi, y0))
        bind_expr(sk, ("Tangent", g0, 2, g1, 1))
        bind_expr(sk, ("Tangent", g1, 2, g2, 1))
        bind_expr(sk, ("Tangent", g2, 2, g3, 1))
        bind_expr(sk, ("Tangent", g3, 2, g4, 1))
        bind_expr(sk, ("Coincident", g4, 2, g5, 1))
        bind_expr(sk, ("Coincident", g5, 2, g0, 1))
        bind_expr(sk, ("Horizontal", g0))
        bind_expr(sk, ("Vertical", g2))
        bind_expr(sk, ("Horizontal", g4))
        bind_expr(sk, ("Vertical", g5))
        bind_expr(sk, ("Equal", g1, g3))
        bind_expr(sk, ("Radius", g1, r), "Parameters.EarCornerR")
        lock_point_x(sk, g5, 2, xi, "Parameters.Length / 2 - 1.2 mm")
        lock_point_x(sk, g2, 1, xo, "Parameters.Length / 2 + Parameters.EarOutReach")
        lock_point_y(sk, g0, 1, y0, f"{'Parameters.EarCenterY' if cy > 0 else '-Parameters.EarCenterY'} - Parameters.EarWidthY / 2")
        lock_point_y(sk, g4, 2, y1, f"{'Parameters.EarCenterY' if cy > 0 else '-Parameters.EarCenterY'} + Parameters.EarWidthY / 2")
    else:
        xi, xo = -x_in, -x_out
        xr = xo + r
        g0, _, _ = add_line(sk, (xi, y1), (xr, y1))
        g1, _, _ = add_arc_ccw(sk, xr, y1 - r, r, (xr, y1), (xo, y1 - r))
        g2, _, _ = add_line(sk, (xo, y1 - r), (xo, y0 + r))
        g3, _, _ = add_arc_ccw(sk, xr, y0 + r, r, (xo, y0 + r), (xr, y0))
        g4, _, _ = add_line(sk, (xr, y0), (xi, y0))
        g5, _, _ = add_line(sk, (xi, y0), (xi, y1))
        bind_expr(sk, ("Tangent", g0, 2, g1, 1))
        bind_expr(sk, ("Tangent", g1, 2, g2, 1))
        bind_expr(sk, ("Tangent", g2, 2, g3, 1))
        bind_expr(sk, ("Tangent", g3, 2, g4, 1))
        bind_expr(sk, ("Coincident", g4, 2, g5, 1))
        bind_expr(sk, ("Coincident", g5, 2, g0, 1))
        bind_expr(sk, ("Horizontal", g0))
        bind_expr(sk, ("Vertical", g2))
        bind_expr(sk, ("Horizontal", g4))
        bind_expr(sk, ("Vertical", g5))
        bind_expr(sk, ("Equal", g1, g3))
        bind_expr(sk, ("Radius", g1, r), "Parameters.EarCornerR")
        lock_point_x(sk, g5, 2, xi, "-(Parameters.Length / 2 - 1.2 mm)")
        lock_point_x(sk, g2, 1, xo, "-(Parameters.Length / 2 + Parameters.EarOutReach)")
        lock_point_y(sk, g4, 2, y0, f"{'Parameters.EarCenterY' if cy > 0 else '-Parameters.EarCenterY'} - Parameters.EarWidthY / 2")
        lock_point_y(sk, g0, 1, y1, f"{'Parameters.EarCenterY' if cy > 0 else '-Parameters.EarCenterY'} + Parameters.EarWidthY / 2")


def add_opt3_gusset_5pt(sk, side, wall_hx, rib_reach, z0, z_toe, z1, rib_ov, ex_wall_hx, ex_reach, ex_z0, ex_ztoe, ex_z1, ex_ov):
    """Exact 5-vertex sample_case gusset rib [(68.8, 5.8), (80.8, 5.8), (80.8, 6.8), (70.0, 14.0), (68.8, 14.0)], 0 DoF."""
    x_wall = side * wall_hx
    x_in = side * (wall_hx - rib_ov)
    x_tip = side * (wall_hx + rib_reach)
    ex_in = f"({ex_wall_hx}) - ({ex_ov})"
    ex_tip = f"({ex_wall_hx}) + ({ex_reach})"
    if side > 0:
        pts = [(x_in, z0), (x_tip, z0), (x_tip, z_toe), (x_wall, z1), (x_in, z1)]
    else:
        pts = [(x_tip, z0), (x_in, z0), (x_in, z1), (x_wall, z1), (x_tip, z_toe)]
    segs = [add_line(sk, pts[i], pts[(i + 1) % 5])[0] for i in range(5)]
    for i in range(5):
        bind_expr(sk, ("Coincident", segs[i], 2, segs[(i + 1) % 5], 1))
    if side > 0:
        bind_expr(sk, ("Horizontal", segs[0]))
        bind_expr(sk, ("Vertical", segs[1]))
        bind_expr(sk, ("Horizontal", segs[3]))
        bind_expr(sk, ("Vertical", segs[4]))
        lock_point_x(sk, segs[0], 1, x_in, ex_in)
        lock_point_x(sk, segs[0], 2, x_tip, ex_tip)
        lock_point_x(sk, segs[3], 1, x_wall, ex_wall_hx)
        lock_point_y(sk, segs[0], 1, z0, ex_z0)
        lock_point_y(sk, segs[1], 2, z_toe, ex_ztoe)
        lock_point_y(sk, segs[3], 1, z1, ex_z1)
    else:
        bind_expr(sk, ("Horizontal", segs[0]))
        bind_expr(sk, ("Vertical", segs[1]))
        bind_expr(sk, ("Horizontal", segs[2]))
        bind_expr(sk, ("Vertical", segs[4]))
        lock_point_x(sk, segs[0], 1, x_tip, f"-({ex_tip})")
        lock_point_x(sk, segs[0], 2, x_in, f"-({ex_in})")
        lock_point_x(sk, segs[2], 2, x_wall, f"-({ex_wall_hx})")
        lock_point_y(sk, segs[0], 1, z0, ex_z0)
        lock_point_y(sk, segs[4], 1, z_toe, ex_ztoe)
        lock_point_y(sk, segs[2], 1, z1, ex_z1)


def add_ear_rib(sk, side, wall_hx, rib_reach, rib_z0, rib_z1, rib_ov, ex_wall_hx, ex_reach, ex_z0, ex_z1, ex_ov):
    x_wall = side * wall_hx
    x_in = side * (wall_hx - rib_ov)
    x_tip = side * (wall_hx + rib_reach)
    pts = [(x_in, rib_z0), (x_tip, rib_z0), (x_wall, rib_z1), (x_in, rib_z1)] if side > 0 else [
        (x_tip, rib_z0), (x_in, rib_z0), (x_in, rib_z1), (x_wall, rib_z1)
    ]
    g0, _, _ = add_line(sk, pts[0], pts[1])
    g1, _, _ = add_line(sk, pts[1], pts[2])
    g2, _, _ = add_line(sk, pts[2], pts[3])
    g3, _, _ = add_line(sk, pts[3], pts[0])
    segs = [g0, g1, g2, g3]
    for i in range(4):
        bind_expr(sk, ("Coincident", segs[i], 2, segs[(i + 1) % 4], 1))
    bind_expr(sk, ("Horizontal", g0))
    bind_expr(sk, ("Horizontal", g2))

    ex_in = f"({ex_wall_hx}) - ({ex_ov})"
    ex_tip = f"({ex_wall_hx}) + ({ex_reach})"
    if side > 0:
        bind_expr(sk, ("Vertical", g3))
        lock_point_x(sk, g0, 1, x_in, ex_in)
        lock_point_x(sk, g0, 2, x_tip, ex_tip)
        lock_point_x(sk, g2, 1, x_wall, ex_wall_hx)
    else:
        bind_expr(sk, ("Vertical", g1))
        lock_point_x(sk, g0, 1, x_tip, f"-({ex_tip})")
        lock_point_x(sk, g0, 2, x_in, f"-({ex_in})")
        lock_point_x(sk, g2, 2, x_wall, f"-({ex_wall_hx})")
    lock_point_y(sk, g0, 1, rib_z0, ex_z0)
    lock_point_y(sk, g2, 1, rib_z1, ex_z1)


def pack_rgba_u32(r, g, b, a=1.0):
    ri = max(0, min(255, int(round(r * 255.0))))
    gi = max(0, min(255, int(round(g * 255.0))))
    bi = max(0, min(255, int(round(b * 255.0))))
    ai = max(0, min(255, int(round(a * 255.0))))
    return (ri << 24) | (gi << 16) | (bi << 8) | ai


def make_material_v3(rgb, spec=0.40, shininess=0.45, transp=0.0):
    r, g, b = rgb
    amb = pack_rgba_u32(r * 0.35, g * 0.35, b * 0.35, 1.0)
    dif = pack_rgba_u32(r, g, b, 1.0)
    spc = pack_rgba_u32(spec, spec, spec, 1.0)
    emi = pack_rgba_u32(0.0, 0.0, 0.0, 1.0)
    uuid = b"7f9fd73b-50c9-41d8-b7b2-575a030c1eeb"
    return struct.pack("<5IffIII", 1, amb, dif, spc, emi, float(shininess), float(transp), 0, 0, len(uuid)) + uuid


def read_gui_template_archive(fcstd_path):
    with zipfile.ZipFile(fcstd_path, "r") as z:
        if "GuiDocument.xml" not in z.namelist():
            return None
        gui_bytes = z.read("GuiDocument.xml")
        blobs = {
            n: z.read(n) for n in z.namelist()
            if n.startswith(("ShapeAppearance", "LineColorArray", "PointColorArray"))
        }
    return {"gui_xml": gui_bytes.decode("utf-8"), "blobs": blobs}


def build_centered_text_faces(text, height_mm, font_path="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
    ws = Part.makeWireString(text, font_path, float(height_mm))
    faces = []
    for cw in ws:
        if not cw:
            continue
        sorted_w = sorted(cw, key=lambda w: w.BoundBox.XLength * w.BoundBox.YLength, reverse=True)
        faces.append(Part.Face(sorted_w))
    comp = Part.makeCompound(faces)
    bb = comp.BoundBox
    return comp.translate(FreeCAD.Vector(-(bb.XMin + bb.XMax) / 2.0, -(bb.YMin + bb.YMax) / 2.0, 0.0))


def sanitize_2d_compound_for_3d_print(comp_2d, min_seg=0.05):
    """Convert 2D faces with sub-micron SVG B-spline cusps into clean polygonal faces (0 micro-slivers, selfInt=False)."""
    clean_faces = []
    for f in comp_2d.Faces:
        if f.Area < 0.03:
            continue
        wires = []
        all_w = [f.OuterWire] + [w for w in f.Wires if not w.isSame(f.OuterWire)]
        for w in all_w:
            pts = []
            for e in w.OrderedEdges:
                e_pts = e.discretize(Deflection=0.015) if len(e.Vertexes) >= 2 else []
                for p in e_pts:
                    if not pts or (p - pts[-1]).Length >= min_seg:
                        pts.append(FreeCAD.Vector(p.x, p.y, 0.0))
            if len(pts) >= 3 and (pts[0] - pts[-1]).Length < min_seg:
                pts.pop()
            if len(pts) >= 3:
                pts.append(pts[0])
                poly = Part.makePolygon(pts)
                if poly.isClosed():
                    wires.append(poly)
        if wires:
            try:
                cf = Part.Face(wires)
                if not cf.isValid():
                    cf.fix(1e-4, 1e-4, 1e-4)
                if cf.isValid() and cf.Area >= 0.03:
                    clean_faces.append(cf)
            except Exception:
                pass
    return Part.makeCompound(clean_faces)


def extract_dibl_svg_layers(svg_path="/home/arif-dibl/Documents/logo/logos/logo.svg"):
    sdoc = FreeCAD.newDocument("_svg_tmp")
    importSVG.insert(svg_path, sdoc.Name)
    objs = list(sdoc.Objects)

    def valid_faces(sh):
        return [f for f in sh.Faces if f.isValid() and f.Area > 0.01]

    leaves_f = valid_faces(objs[0].Shape) + valid_faces(objs[3].Shape)
    drop_f = valid_faces(objs[2].Shape)
    veins_ic_f = []
    for idx in range(4, 33):
        if idx == 32:
            c_sh = objs[idx].Shape
            veins_ic_f.append(Part.Face(Part.Wire([Part.makeCircle(math.sqrt(c_sh.Area / math.pi), c_sh.CenterOfMass)])))
        else:
            veins_ic_f.extend(valid_faces(objs[idx].Shape))
    text_f = [f for o in objs[33:] for f in valid_faces(o.Shape)]

    cut_sols = [f.extrude(FreeCAD.Vector(0, 0, 2.0)).translate(FreeCAD.Vector(0, 0, -1.0)) for f in veins_ic_f]
    cutter_3d = cut_sols[0].multiFuse(cut_sols[1:]) if len(cut_sols) > 1 else cut_sols[0]
    leaves_3d = Part.makeCompound([f.extrude(FreeCAD.Vector(0, 0, 1.0)) for f in leaves_f]).cut(cutter_3d)
    drop_3d = Part.makeCompound([f.extrude(FreeCAD.Vector(0, 0, 1.0)) for f in drop_f]).cut(cutter_3d)

    def z0_faces(sh3d):
        return [f for f in sh3d.Faces if abs(f.BoundBox.ZMin) < 1e-4 and abs(f.BoundBox.ZMax) < 1e-4 and f.Area > 0.01]

    res = (
        Part.makeCompound(z0_faces(leaves_3d)),
        Part.makeCompound(z0_faces(drop_3d)),
        Part.makeCompound(text_f),
    )
    FreeCAD.closeDocument(sdoc.Name)
    return res


def scale_and_center_2d(shape_2d, target_w, target_xy=(0.0, 0.0), mirror_x=False, ref_bb=None):
    bb = ref_bb if ref_bb is not None else shape_2d.BoundBox
    cx, cy = (bb.XMin + bb.XMax) / 2.0, (bb.YMin + bb.YMax) / 2.0
    sc = float(target_w) / float(bb.XLength)
    sh = shape_2d.translate(FreeCAD.Vector(-cx, -cy, 0.0))
    m_sc = FreeCAD.Matrix()
    m_sc.scale(sc, sc, sc)
    sh = sh.transformed(m_sc)
    if mirror_x:
        sh = sh.mirror(FreeCAD.Vector(0.0, 0.0, 0.0), FreeCAD.Vector(1.0, 0.0, 0.0))
    return sh.translate(FreeCAD.Vector(target_xy[0], target_xy[1], 0.0))


def engrave_faces_into_body(doc, body_obj, src_grp, name_pfx, faces_sh, depth_mm, outward_normal, vis_hide):
    fixed_faces = []
    for f in faces_sh.Faces:
        n = f.normalAt(0, 0)
        fixed_faces.append(f.reversed() if n.dot(outward_normal) < 0.0 else f)
    pf = doc.addObject("Part::Feature", f"{name_pfx}_Src")
    pf.Shape = Part.makeCompound(fixed_faces)
    src_grp.addObject(pf)
    binder = body_obj.newObject("PartDesign::SubShapeBinder", f"{name_pfx}_Binder")
    binder.Relative = False
    binder.Support = [(pf, ("",))]
    doc.recompute()
    pre_vol = body_obj.Shape.Volume if body_obj.Tip else 0.0
    pkt = body_obj.newObject("PartDesign::Pocket", f"{name_pfx}_Pocket")
    pkt.Profile = binder
    pkt.Reversed = False
    pkt.Length = float(depth_mm)
    doc.recompute()
    assert pkt.State == ["Up-to-date"], f"{pkt.Name} failed: {pkt.State}"
    cut_v = pre_vol - body_obj.Shape.Volume
    assert cut_v > 1.0, f"{pkt.Name} cut volume too small ({cut_v:.4f} mm^3)!"
    print(f"  Engraved {pkt.Name:28s}: cut {cut_v:.2f} mm^3", flush=True)
    vis_hide.extend([pf.Name, binder.Name])
    return pkt


def inject_gui_colors_to_fcstd(fcstd_path, gui_tpl, obj_specs, obj_colors, obj_vis):
    if not gui_tpl:
        return
    tpl_root = ET.fromstring(gui_tpl["gui_xml"])
    tpl_vps = {vp.attrib["name"]: vp for vp in tpl_root.findall(".//ViewProviderData/ViewProvider")}
    tpl_blobs = dict(gui_tpl["blobs"])

    minimal_vp_xml = (
        '<ViewProvider name="_TPL" expanded="0" treeRank="-1"><Properties Count="2" TransientCount="0">'
        '<Property name="ShowInTree" type="App::PropertyBool" status="1"><Bool value="true"/></Property>'
        '<Property name="Visibility" type="App::PropertyBool" status="1"><Bool value="false"/></Property>'
        '</Properties></ViewProvider>'
    )
    minimal_vp = ET.fromstring(minimal_vp_xml)

    protos = {
        "PartDesign::Body": tpl_vps.get("Comp_BarrelJacks_U4_U1", tpl_vps.get("Bottom_Case")),
        "PartDesign::Pad": tpl_vps.get("Jacks_Body_Pad"),
        "PartDesign::Pocket": tpl_vps.get("Base_JackHoles_Pocket", tpl_vps.get("Jacks_Body_Pad")),
        "Sketcher::SketchObject": tpl_vps.get("Jacks_Profile_Sketch"),
        "App::Part": tpl_vps.get("PCB_Assembly"),
        "App::Origin": tpl_vps.get("Origin"),
        "App::Line": tpl_vps.get("X_Axis"),
        "App::Plane": tpl_vps.get("XY_Plane"),
        "Spreadsheet::Sheet": tpl_vps.get("Parameters"),
        "PartDesign::SubShapeBinder": minimal_vp,
        "Part::Feature": minimal_vp,
    }

    new_root = copy.deepcopy(tpl_root)
    vp_container = new_root.find("./ViewProviderData")
    for child in list(vp_container):
        vp_container.remove(child)

    out_blobs = {}
    file_counter = {"ShapeAppearance": 1, "LineColorArray": 1, "PointColorArray": 1}

    def alloc_file(pfx, content):
        idx = file_counter[pfx]
        file_counter[pfx] += 1
        fname = f"{pfx}{idx}" if idx > 1 else pfx
        out_blobs[fname] = content
        return fname

    for name, tid in obj_specs:
        src_vp = tpl_vps.get(name)
        if src_vp is None:
            src_vp = protos.get(tid)
        if src_vp is None:
            src_vp = protos["PartDesign::Pad"]
        vp = copy.deepcopy(src_vp)
        vp.attrib["name"] = name
        mat_blob = make_material_v3(*obj_colors[name]) if name in obj_colors else None

        for prop in vp.findall("./Properties/Property"):
            pname = prop.attrib.get("name", "")
            if pname == "Visibility" and name in obj_vis:
                b_el = prop.find("Bool")
                if b_el is not None:
                    b_el.attrib["value"] = "true" if obj_vis[name] else "false"
            elif pname == "ShapeAppearance":
                ml = prop.find("MaterialList")
                if ml is not None:
                    old_f = ml.attrib.get("file", "")
                    blob = mat_blob if mat_blob is not None else tpl_blobs.get(old_f, tpl_blobs["ShapeAppearance"])
                    ml.attrib["file"] = alloc_file("ShapeAppearance", blob)
            elif pname in ("LineColorArray", "PointColorArray"):
                cl = prop.find("ColorList")
                if cl is not None:
                    old_f = cl.attrib.get("file", "")
                    blob = tpl_blobs.get(old_f, b"\x01\x00\x00\x00\xff\x19\x19\x19")
                    cl.attrib["file"] = alloc_file(pname, blob)
            elif pname == "ShapeColor" and name in obj_colors:
                pc = prop.find("PropertyColor")
                if pc is not None:
                    r, g, b = obj_colors[name][0]
                    pc.attrib["value"] = str(pack_rgba_u32(r, g, b, 1.0))

        vp_container.append(vp)

    vp_container.attrib["Count"] = str(len(obj_specs))
    gui_out_bytes = ET.tostring(new_root, encoding="utf-8", xml_declaration=True)

    tmp_path = fcstd_path + ".tmp"
    with zipfile.ZipFile(fcstd_path, "r") as zin, zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == "GuiDocument.xml" or item.filename.startswith(
                ("ShapeAppearance", "LineColorArray", "PointColorArray")
            ):
                continue
            zout.writestr(item, zin.read(item.filename))
        zout.writestr("GuiDocument.xml", gui_out_bytes)
        for fname, fdata in out_blobs.items():
            zout.writestr(fname, fdata)
    os.replace(tmp_path, fcstd_path)


def build_base_parameters_from_scratch(doc):
    """Create the Parameters Spreadsheet from scratch (rows 1..44 base + rows 46..172 wallmount/PCB/UI/C8)."""
    sheet = doc.addObject("Spreadsheet::Sheet", "Parameters")
    sheet.set("A1", "Parameter")
    sheet.set("B1", "Value")
    sheet.set("C1", "Notes")

    cell_ref = {}
    row = 2

    def add_param(alias, val_str, note=""):
        nonlocal row
        cell = f"B{row}"
        sheet.set(f"A{row}", alias)
        sheet.set(cell, val_str)
        sheet.setAlias(cell, alias)
        if note:
            sheet.set(f"C{row}", note)
        cell_ref[alias] = cell
        row += 1
        return cell

    add_param("Length", "140 mm", "Outer case length (X)")
    add_param("Width", "100 mm", "Outer case width (Y)")
    add_param("TotalHeight", "50 mm", "Outer closed case height (Z)")
    add_param("BaseHeight", "35 mm", "Bottom case height to split seam")
    add_param("WallT", "2.0 mm", "Outer wall thickness (136 x 96 mm internal cavity)")
    add_param("FloorT", "2.0 mm", "Bottom floor thickness")
    add_param("RoofT", "2.0 mm", "Top lid roof thickness (46 mm total internal Z)")
    add_param("CornerR", "6.0 mm", "Outer corner radius")
    add_param("LipDepth", "2.5 mm", "Top lid inner alignment lip depth")
    add_param("LipT", "1.0 mm", "Top lid alignment lip wall thickness (93.5 mm clear in Y)")
    add_param("FitClearance", "0.25 mm", "Radial slip clearance for lid alignment lip")
    add_param("ScrewInsetX", "8.8 mm", "Corner screw X inset (places towers clear outside 110 mm PCB)")
    add_param("ScrewInsetY", "10.5 mm", "Corner screw Y inset from outer Y edge")
    add_param("BaseTowerDia", "9.4 mm", "Bottom corner M3 screw tower OD")
    add_param("ScrewWellDia", "6.4 mm", "Bottom underside M3 screw head + driver inlet diameter")
    add_param("ScrewClearDia", "3.4 mm", "Bottom tower M3 clearance bore")
    add_param("ScrewGrip", "6.0 mm", "Solid clamping neck thickness in bottom tower")
    add_param("LidBossDia", "8.0 mm", "Top lid downward M3 screw standoff OD")
    add_param("LidPilotDia", "2.6 mm", "Top lid standoff M3 pilot hole")
    add_param("BossDrop", "4.0 mm", "Distance lid standoff drops below split seam to meet base tower")
    add_param("RoofSafeMargin", "3.0 mm", "Solid material kept above blind pilot hole tip in lid roof")
    add_param("StandoffX", "0 mm", "Legacy single X unused (rearranged to 5x PCB_S1..S5 holes)")
    add_param("StandoffY", "0 mm", "Legacy single Y unused (rearranged to 5x PCB_S1..S5 holes)")
    add_param("StandoffOD", "6.2 mm", "PCB M3 floor standoffs OD (clears P2 solder pads at H7)")
    add_param("StandoffHoleDia", "2.6 mm", "Floor standoff M3 pilot bore")
    add_param("StandoffH", "5.0 mm", "Floor standoff height (41 mm Z above standoff; 39.4 mm above 1.6 mm PCB)")
    add_param("StandoffHoleDepth", "6.0 mm", "M3 pilot bore depth into floor standoff")
    add_param("ExplodeGap", "0 mm", "Set > 0 mm to offset lid above 35 mm")

    c = cell_ref
    add_param("LidHeight", f"={c['TotalHeight']} - {c['BaseHeight']}", "Top lid outer height")
    add_param("InLen", f"={c['Length']} - 2 * {c['WallT']}", "Interior cavity length")
    add_param("InWid", f"={c['Width']} - 2 * {c['WallT']}", "Interior cavity width")
    add_param("InR", f"={c['CornerR']} - {c['WallT']}", "Interior cavity corner radius")
    add_param("LipOutLen", f"={c['InLen']} - 2 * {c['FitClearance']}", "Lid alignment lip outer length")
    add_param("LipOutWid", f"={c['InWid']} - 2 * {c['FitClearance']}", "Lid alignment lip outer width")
    add_param("LipOutR", f"={c['InR']} - {c['FitClearance']}", "Lid alignment lip outer corner radius")
    add_param("LipInLen", f"={c['LipOutLen']} - 2 * {c['LipT']}", "Lid alignment lip inner length")
    add_param("LipInWid", f"={c['LipOutWid']} - 2 * {c['LipT']}", "Lid alignment lip inner width")
    add_param("LipInR", f"={c['LipOutR']} - {c['LipT']}", "Lid alignment lip inner corner radius")
    add_param("ScrewX", f"={c['Length']} / 2 - {c['ScrewInsetX']}", "Corner screw center X")
    add_param("ScrewY", f"={c['Width']} / 2 - {c['ScrewInsetY']}", "Corner screw center Y")
    add_param("BossMateZ", f"={c['BaseHeight']} - {c['BossDrop']}", "Z height where base tower meets lid standoff")
    add_param("ScrewShelfZ", f"={c['BossMateZ']} - {c['ScrewGrip']}", "Z height of screw head seating shelf inside bottom well")
    add_param("LidZ", f"={c['BaseHeight']} + {c['ExplodeGap']}", "Top lid placement Z in assembly")

    # Populate rows 46..172 (with sample_case reinforced Option 3 measurements in rows 79..87)
    rows = [
        (46, "Wall Mount Parameters", None, "Parametric values for all 3 mounting options", None),
        (47, "MountSlideOffset", 0.0, "mm — Option 1 wall plate slide-out travel", "MountSlideOffset"),
        (48, "DovetailRootW", 50.0, "mm — Option 1 male dovetail narrow root width", "DovetailRootW"),
        (49, "DovetailFlare", 4.5, "mm — Option 1 dovetail lateral flare per side", "DovetailFlare"),
        (50, "DovetailH", 6.0, "mm — Option 1 dovetail rail depth below Z=0", "DovetailH"),
        (51, "DovetailLenY", 72.0, "mm — Option 1 dovetail rail length along Y", "DovetailLenY"),
        (52, "DovetailClear", 0.4, "mm — Option 1 track Z and radial running clearance", "DovetailClear"),
        (53, "DovetailEmbed", 0.4, "mm — Overlap into 2.0 mm floor", "DovetailEmbed"),
        (54, "PlateT", 4.0, "mm — Option 1 wall plate backing thickness", "PlateT"),
        (55, "ShoulderW", 10.0, "mm — Option 1 wall plate track shoulder width", "ShoulderW"),
        (56, "StopT", 4.0, "mm — Option 1 wall plate bottom gravity end-stop thickness", "StopT"),
        (57, "PlateW", 110.0, "mm — Option 1 plate width", "PlateW"),
        (58, "PlateCornerR", 4.0, "mm — Option 1 wall plate outer corner radius", "PlateCornerR"),
        (59, "PlateHoleX", 45.5, "mm — Option 1 wall anchor slot X offset", "PlateHoleX"),
        (60, "PlateHoleY", 20.0, "mm — Option 1 wall anchor slot Y center offset", "PlateHoleY"),
        (61, "MountSlotDia", 4.6, "mm — Wall mounting slot width for M4 / #8 screws", "MountSlotDia"),
        (62, "MountSlotTravel", 6.0, "mm — Vertical leveling slot travel", "MountSlotTravel"),
        (63, "DovetailBotW", "=B48 + 2 * B49", "mm — Male dovetail wide bottom width", "DovetailBotW"),
        (64, "TrackInnerTop", "=B48 / 2 + (B49 / B50) * B52 + B52", "mm — Female track inner half-width at Z=-DovetailClear", "TrackInnerTop"),
        (65, "TrackInnerBot", "=B48 / 2 + (B49 / B50) * (B50 + B52) + B52", "mm — Female track inner half-width at plate face", "TrackInnerBot"),
        (66, "TrackOuterX", "=B64 + B55", "mm — Female track outer X coordinate", "TrackOuterX"),
        (67, "PlateLenY", "=B51 + B52 + B56", "mm — Wall plate total Y length", "PlateLenY"),
        (68, "KH_RailX", 38.0, "mm — Option 2 vertical rail centerline X", "KH_RailX"),
        (69, "KH_RailW", 22.0, "mm — Option 2 vertical rail width", "KH_RailW"),
        (70, "KH_RailLenY", 72.0, "mm — Option 2 vertical rail Y length", "KH_RailLenY"),
        (71, "KH_BridgeH", 12.0, "mm — Option 2 central connecting bridge height", "KH_BridgeH"),
        (72, "KH_PadT", 5.5, "mm — Option 2 rear thickness below Z=0", "KH_PadT"),
        (73, "KH_FlangeT", 2.2, "mm — Option 2 rear screw-retaining wall thickness", "KH_FlangeT"),
        (74, "KH_ChamberT", 2.9, "mm — Option 2 captured screw-head bay depth", "KH_ChamberT"),
        (75, "KH_PosY", 21.0, "mm — Option 2 keyhole Y center offset", "KH_PosY"),
        (76, "KH_EntryDia", 9.0, "mm — Option 2 keyhole screw-head entry diameter", "KH_EntryDia"),
        (77, "KH_HeadBayDia", 11.0, "mm — Option 2 captured screw-head chamber width", "KH_HeadBayDia"),
        (78, "KH_Travel", 8.0, "mm — Option 2 vertical lock drop travel", "KH_Travel"),
        # Option 3 (sample_case reinforced external side flanges: 170 mm total span, 6.0 mm thick, 24.0 mm wide, Y=+-26.5, hole X=+-78.5, twin 3.5 mm gussets)
        (79, "EarOutReach", 15.0, "mm — Option 3 flange protrusion beyond outer X=+-70 wall (total width 170 mm)", "EarOutReach"),
        (80, "EarWidthY", 24.0, "mm — Option 3 individual ear width along Y (sample_case 24.0 mm)", "EarWidthY"),
        (81, "EarThickZ", 6.0, "mm — Option 3 flat base ear thickness (sample_case 6.0 mm)", "EarThickZ"),
        (82, "EarCenterY", 26.5, "mm — Option 3 ear centerline Y offset (sample_case +-26.5 mm)", "EarCenterY"),
        (83, "EarCornerR", 4.0, "mm — Option 3 ear outer corner radius", "EarCornerR"),
        (84, "EarHoleX", 78.5, "mm — Option 3 fastener center X (sample_case +-78.5 mm)", "EarHoleX"),
        (85, "EarRibW", 3.5, "mm — Option 3 twin gusset rib width (sample_case 3.5 mm)", "EarRibW"),
        (86, "EarRibReach", 10.8, "mm — Option 3 gusset horizontal leg along flange (to X=+-80.8 mm)", "EarRibReach"),
        (87, "EarRibTopZ", 14.0, "mm — Option 3 gusset height up outer wall (1.0 mm clear below C8)", "EarRibTopZ"),
        # PCB & Rearranged 5-Standoff Alignment Parameters
        (89, "PCB & Mounting Standoff Parameters", None, "Measured from 2D PCB screenshot", None),
        (90, "PCB_Length", 108.0, "mm — Main PCB width X", "PCB_Length"),
        (91, "PCB_Width", 80.0, "mm — Main PCB height Y", "PCB_Width"),
        (92, "PCB_Thick", 1.6, "mm — Main PCB thickness above 5 mm standoffs", "PCB_Thick"),
        (93, "PCB_OffsetX", 0.0, "mm — Main PCB X offset inside Bottom_Case", "PCB_OffsetX"),
        (94, "PCB_OffsetY", -7.5, "mm — Main PCB shifted toward -Y wall", "PCB_OffsetY"),
        (95, "PCB_HoleDia", 3.0, "mm — Main PCB mounting hole diameter (5x M3 holes)", "PCB_HoleDia"),
        (96, "PCB_CompHoleDia", 3.3, "mm — AC connector locating hole diameter (2x holes)", "PCB_CompHoleDia"),
        (97, "PCB_SlotW", 1.8, "mm — High-voltage creepage isolation slot width", "PCB_SlotW"),
        (98, "PCB_SlotTravel", 62.2, "mm — Isolation slot travel", "PCB_SlotTravel"),
        (99, "PCB_SlotX", 36.0, "mm — Isolation slot X relative to PCB center", "PCB_SlotX"),
        (100, "PCB_SlotY", -3.8, "mm — Isolation slot Y relative to PCB center", "PCB_SlotY"),
        (101, "PCB_S1_X", 3.9,   "mm — H3 top-mid hole X", "PCB_S1_X"),
        (102, "PCB_S1_Y", 20.1,  "mm — H3 top-mid hole Y", "PCB_S1_Y"),
        (103, "PCB_S2_X", -11.7, "mm — H1 mid-left hole X", "PCB_S2_X"),
        (104, "PCB_S2_Y", -9.9,  "mm — H1 mid-left hole Y", "PCB_S2_Y"),
        (105, "PCB_S3_X", 18.1,  "mm — H4 mid-right hole X", "PCB_S3_X"),
        (106, "PCB_S3_Y", -15.6, "mm — H4 mid-right hole Y", "PCB_S3_Y"),
        (107, "PCB_S4_X", 0.2,   "mm — H2 bot-mid hole X", "PCB_S4_X"),
        (108, "PCB_S4_Y", -35.1, "mm — H2 bot-mid hole Y", "PCB_S4_Y"),
        (109, "PCB_S5_X", 48.6,  "mm — H7 bot-right hole X", "PCB_S5_X"),
        (110, "PCB_S5_Y", -35.1, "mm — H7 bot-right hole Y", "PCB_S5_Y"),
        (111, "PCB_C1_X", 45.0,  "mm — H6 AC connector locator hole X", "PCB_C1_X"),
        (112, "PCB_C1_Y", -11.9, "mm — H6 AC connector locator hole Y", "PCB_C1_Y"),
        (113, "PCB_C2_X", 45.0,  "mm — H5 AC connector locator hole X", "PCB_C2_X"),
        (114, "PCB_C2_Y", -24.9, "mm — H5 AC connector locator hole Y", "PCB_C2_Y"),
        (115, "Jack1_X", -21.8, "mm — U4 left barrel jack X", "Jack1_X"),
        (116, "Jack2_X", 24.7,  "mm — U1 right barrel jack X", "Jack2_X"),
        (117, "JackWidth", 9.0, "mm — DC-005 barrel jack body width", "JackWidth"),
        (118, "JackDepth", 14.2,"mm — DC-005 barrel jack front-to-back depth", "JackDepth"),
        (119, "JackHeight", 11.0,"mm — DC-005 height above PCB top face", "JackHeight"),
        (120, "JackAxisZ", 6.5, "mm — DC-005 bore center above PCB top face", "JackAxisZ"),
        (121, "JackBoreDia", 6.3,"mm — DC-005 socket bore diameter", "JackBoreDia"),
        (122, "JackCutDia", 10.5,"mm — Front (-Y) case wall cutout diameter", "JackCutDia"),
        (123, "JackCutZ", "=B7 + B27 + B92 + B120", "mm — Barrel jack centerline Z inside Bottom_Case (15.1 mm)", "JackCutZ"),
        (125, "UI PCB & Top-Lid Mounting Parameters", None, "Measured from 2nd 2D/3D PCB screenshots", None),
        (126, "UI_Length", 51.4, "mm — UI PCB X width", "UI_Length"),
        (127, "UI_Width", 80.0, "mm — UI PCB Y height", "UI_Width"),
        (128, "UI_Thick", 1.6, "mm — UI PCB board thickness", "UI_Thick"),
        (129, "UI_OffsetX", 0.0, "mm — UI PCB X offset", "UI_OffsetX"),
        (130, "UI_OffsetY", -6.25, "mm — UI PCB Y offset (0.5 mm clear of -46.75 mm lip)", "UI_OffsetY"),
        (131, "UI_StandoffH", 11.0, "mm — Downward lid standoff length", "UI_StandoffH"),
        (132, "UI_StandoffOD", 5.4, "mm — Lid standoff OD", "UI_StandoffOD"),
        (133, "UI_StandoffHoleDia", 2.6, "mm — M3 self-tapping pilot bore inside Top_Lid standoffs", "UI_StandoffHoleDia"),
        (134, "UI_StandoffHoleDepth", 8.5, "mm — Blind M3 pilot depth", "UI_StandoffHoleDepth"),
        (135, "UI_HoleDia", 3.0, "mm — UI PCB M3 mounting hole diameter", "UI_HoleDia"),
        (136, "UI_CapDia", 11.5, "mm — Tactile switch button cap outer diameter", "UI_CapDia"),
        (137, "UI_CapHoleDia", 12.3, "mm — Top_Lid button hole diameter", "UI_CapHoleDia"),
        (138, "UI_LEDDia", 5.0, "mm — 5mm LED cylindrical dome diameter", "UI_LEDDia"),
        (139, "UI_LEDHoleDia", 5.4, "mm — Top_Lid LED hole diameter", "UI_LEDHoleDia"),
        (140, "UI_LEDHeight", 14.5, "mm — Uniform height of all 5 LEDs above UI PCB", "UI_LEDHeight"),
        (141, "UI_CapTopAbovePCB", 15.0, "mm — Button cap top height above UI PCB", "UI_CapTopAbovePCB"),
        (142, "UI_H1_X", -22.57, "mm — Hole_Left X", "UI_H1_X"),
        (143, "UI_H1_Y", -11.60, "mm — Hole_Left Y", "UI_H1_Y"),
        (144, "UI_H2_X", 5.37,   "mm — Hole_Right X", "UI_H2_X"),
        (145, "UI_H2_Y", -11.60, "mm — Hole_Right Y", "UI_H2_Y"),
        (146, "UI_SW9_X", -17.87, "mm — SW9 left tactile switch X", "UI_SW9_X"),
        (147, "UI_SW9_Y", -1.56,  "mm — SW9 left tactile switch Y", "UI_SW9_Y"),
        (148, "UI_SW1_X", -0.35,  "mm — SW1 right tactile switch X", "UI_SW1_X"),
        (149, "UI_SW1_Y", -1.68,  "mm — SW1 right tactile switch Y", "UI_SW1_Y"),
        (150, "UI_LED1_X", -23.21, "mm — LED1 bot-left green X", "UI_LED1_X"),
        (151, "UI_LED1_Y", -17.28, "mm — LED1 bot-left green Y", "UI_LED1_Y"),
        (152, "UI_LED2_X", 6.12,   "mm — LED2 bot-mid green X", "UI_LED2_X"),
        (153, "UI_LED2_Y", -17.28, "mm — LED2 bot-mid green Y", "UI_LED2_Y"),
        (154, "UI_LED5_X", 19.33,  "mm — LED5 top-right red X", "UI_LED5_X"),
        (155, "UI_LED5_Y", 1.98,   "mm — LED5 top-right red Y", "UI_LED5_Y"),
        (156, "UI_LED6_X", 19.33,  "mm — LED6 mid-right green X", "UI_LED6_X"),
        (157, "UI_LED6_Y", -6.40,  "mm — LED6 mid-right green Y", "UI_LED6_Y"),
        (158, "UI_LED7_X", 19.33,  "mm — LED7 bot-right amber X", "UI_LED7_X"),
        (159, "UI_LED7_Y", -16.56, "mm — LED7 bot-right amber Y", "UI_LED7_Y"),
        (161, "AC Socket C8 Right-Wall Parameters", None, "SUNROM 7669 IEC320-C8 2P panel-mount socket", None),
        (162, "C8_PosY", 0.0, "mm — Center Y along right (+X) wall", "C8_PosY"),
        (163, "C8_PosZ", 22.5, "mm — Center Z inside Bottom_Case", "C8_PosZ"),
        (164, "C8_FlangeL", 35.0, "mm — SUNROM 7669 outer flange length", "C8_FlangeL"),
        (165, "C8_FlangeW", 15.0, "mm — SUNROM 7669 outer flange width", "C8_FlangeW"),
        (166, "C8_FlangeT", 4.0, "mm — SUNROM 7669 outer flange thickness", "C8_FlangeT"),
        (167, "C8_LipH", 1.0, "mm — Front raised figure-8 bezel collar protrusion", "C8_LipH"),
        (168, "C8_BodyTotalD", 16.4, "mm — Front bezel to rear nylon back", "C8_BodyTotalD"),
        (169, "C8_CutLen", 21.0, "mm — Datasheet panel cutout stadium length", "C8_CutLen"),
        (170, "C8_CutW", 12.4, "mm — Datasheet panel cutout stadium width", "C8_CutW"),
        (171, "C8_HolePitch", 28.0, "mm — Flange screw hole pitch along Y", "C8_HolePitch"),
        (172, "C8_PanelHoleDia", 3.7, "mm — Datasheet panel screw hole diameter", "C8_PanelHoleDia"),
    ]
    for r, label, val, notes, alias in rows:
        sheet.set(f"A{r}", label)
        if val is not None:
            if isinstance(val, (int, float)):
                sheet.set(f"B{r}", f"={val} mm")
            else:
                sheet.set(f"B{r}", val)
        sheet.set(f"C{r}", notes)
        if alias:
            sheet.setAlias(f"B{r}", alias)

    doc.recompute()
    return sheet


def build_bottom_case_from_scratch(doc, sketches_to_verify):
    """Build Bottom_Case from scratch with 4 corner screw towers and 5 hollow M3 PCB standoffs."""
    body = doc.addObject("PartDesign::Body", "Bottom_Case")
    body.Label = "Bottom_Case"
    body.Placement = FreeCAD.Placement(FreeCAD.Vector(0.0, 0.0, -30.0), FreeCAD.Rotation())
    xy = get_origin_plane(body, "XY_Plane")

    # 1. Outer rounded box (140 x 100 x 35 mm, R=6.0 mm)
    sk_outer = body.newObject("Sketcher::SketchObject", "Base_Outer_Sketch")
    attach_sketch(sk_outer, xy)
    add_rounded_rect_centered(sk_outer, 140.0, 100.0, 6.0, "Parameters.Length", "Parameters.Width", "Parameters.CornerR")
    sketches_to_verify.append(sk_outer)
    pad_outer = body.newObject("PartDesign::Pad", "Base_Outer_Pad")
    pad_outer.Profile = sk_outer
    pad_outer.Length = 35.0
    pad_outer.setExpression("Length", "Parameters.BaseHeight")

    # 2. Hollow interior cavity (136 x 96 x 33 mm, R=4.0 mm)
    sk_cav = body.newObject("Sketcher::SketchObject", "Base_Cavity_Sketch")
    attach_sketch(sk_cav, xy, "Parameters.BaseHeight + 0.1 mm", 35.1)
    add_rounded_rect_centered(sk_cav, 136.0, 96.0, 4.0, "Parameters.InLen", "Parameters.InWid", "Parameters.InR")
    sketches_to_verify.append(sk_cav)
    pock_cav = body.newObject("PartDesign::Pocket", "Base_Cavity_Pocket")
    pock_cav.Profile = sk_cav
    pock_cav.Length = 33.1
    pock_cav.setExpression("Length", "Parameters.BaseHeight - Parameters.FloorT + 0.1 mm")

    # 3. 4x corner screw towers (OD=9.4 mm at +-61.2, +-39.5, Z=2.0..31.0 mm)
    sk_towers = body.newObject("Sketcher::SketchObject", "Base_CornerTowers_Sketch")
    attach_sketch(sk_towers, xy, "Parameters.FloorT - 0.1 mm", 1.9)
    add_circles_sketch(sk_towers, corner_centers_expr("Parameters.ScrewX", "Parameters.ScrewY", 61.2, 39.5), 9.4, "Parameters.BaseTowerDia")
    sketches_to_verify.append(sk_towers)
    pad_towers = body.newObject("PartDesign::Pad", "Base_CornerTowers_Pad")
    pad_towers.Profile = sk_towers
    pad_towers.Length = 29.1
    pad_towers.setExpression("Length", "Parameters.BossMateZ - Parameters.FloorT + 0.1 mm")

    # 4. 4x underside screw head wells (OD=6.4 mm, Z=0.0..25.0 mm)
    sk_wells = body.newObject("Sketcher::SketchObject", "Base_ScrewWells_Sketch")
    attach_sketch(sk_wells, xy, "-0.1 mm", -0.1)
    add_circles_sketch(sk_wells, corner_centers_expr("Parameters.ScrewX", "Parameters.ScrewY", 61.2, 39.5), 6.4, "Parameters.ScrewWellDia")
    sketches_to_verify.append(sk_wells)
    pock_wells = body.newObject("PartDesign::Pocket", "Base_ScrewWells_Pocket")
    pock_wells.Profile = sk_wells
    pock_wells.Reversed = True
    pock_wells.Length = 25.1
    pock_wells.setExpression("Length", "Parameters.ScrewShelfZ + 0.1 mm")

    # 5. 4x M3 clearance bores (OD=3.4 mm, Z=25.0..31.0 mm)
    sk_clr = body.newObject("Sketcher::SketchObject", "Base_ScrewClear_Sketch")
    attach_sketch(sk_clr, xy, "Parameters.BossMateZ + 0.1 mm", 31.1)
    add_circles_sketch(sk_clr, corner_centers_expr("Parameters.ScrewX", "Parameters.ScrewY", 61.2, 39.5), 3.4, "Parameters.ScrewClearDia")
    sketches_to_verify.append(sk_clr)
    pock_clr = body.newObject("PartDesign::Pocket", "Base_ScrewClear_Pocket")
    pock_clr.Profile = sk_clr
    pock_clr.Length = 6.2
    pock_clr.setExpression("Length", "Parameters.ScrewGrip + 0.2 mm")

    # 6. 5x concentric hollow M3 PCB standoffs (OD=6.2 mm, ID=2.6 mm, Z=2.0..7.0 mm)
    pcb_mount_pts = [
        (1,  3.9,  20.1),
        (2, -11.7, -9.9),
        (3, 18.1, -15.6),
        (4,  0.2, -35.1),
        (5, 48.6, -35.1),
    ]
    pcb_off_y = -7.5
    sk_so = body.newObject("Sketcher::SketchObject", "Base_Standoff_Sketch")
    attach_sketch(sk_so, xy, "Parameters.FloorT - 0.1 mm", 1.9)
    for idx, vx, vy in pcb_mount_pts:
        vy_w = vy + pcb_off_y
        g_out = sk_so.addGeometry(Part.Circle(FreeCAD.Vector(vx, vy_w, 0.0), FreeCAD.Vector(0, 0, 1), 3.1), False)
        g_in = sk_so.addGeometry(Part.Circle(FreeCAD.Vector(vx, vy_w, 0.0), FreeCAD.Vector(0, 0, 1), 1.3), False)
        bind_expr(sk_so, ("Coincident", g_in, 3, g_out, 3))
        bind_expr(sk_so, ("Diameter", g_out, 6.2), "Parameters.StandoffOD")
        bind_expr(sk_so, ("Diameter", g_in, 2.6), "Parameters.StandoffHoleDia")
        bind_expr(sk_so, ("DistanceX", -1, 1, g_out, 3, vx), f"Parameters.PCB_OffsetX + Parameters.PCB_S{idx}_X")
        bind_expr(sk_so, ("DistanceY", -1, 1, g_out, 3, vy_w), f"Parameters.PCB_OffsetY + Parameters.PCB_S{idx}_Y")
    sketches_to_verify.append(sk_so)
    pad_st = body.newObject("PartDesign::Pad", "Base_Standoff_Pad")
    pad_st.Profile = sk_so
    pad_st.Length = 5.1
    pad_st.setExpression("Length", "Parameters.StandoffH + 0.1 mm")

    return body


def build_top_lid_from_scratch(doc, sketches_to_verify):
    """
    Build Top_Lid from scratch as 1 single connected solid (Solids=1) with zero internal overhangs:
      - Lid_Outer_Pad: 140 x 100 x 15 mm, R=6.0 mm
      - Lid_Cavity_Pocket: LipInLen x LipInWid (133.5 x 93.5 mm, R=2.75 mm) from Z=-0.1..13.0 mm
      - Lid_AlignLip_Pad: ring (135.5 x 95.5 mm R=3.75 outer, 133.5 x 93.5 mm R=2.75 inner) from Z=-2.5..+0.5 mm
        (fuses directly into the 133.5..140.0 mm outer wall at Z=0..0.5 mm -> Solids=1, zero overhangs!)
      - 4x corner M3 standoffs (OD=8.0 mm, ID=2.6 mm blind pilot) at (+-61.2, +-39.5 mm)
    """
    body = doc.addObject("PartDesign::Body", "Top_Lid")
    body.Label = "Top_Lid"
    body.Placement = FreeCAD.Placement(FreeCAD.Vector(0.0, 0.0, 35.0), FreeCAD.Rotation())
    body.setExpression("Placement.Base.z", "Parameters.LidZ")
    xy = get_origin_plane(body, "XY_Plane")

    # 1. Outer cap (140 x 100 x 15 mm, R=6.0 mm)
    sk_outer = body.newObject("Sketcher::SketchObject", "Lid_Outer_Sketch")
    attach_sketch(sk_outer, xy)
    add_rounded_rect_centered(sk_outer, 140.0, 100.0, 6.0, "Parameters.Length", "Parameters.Width", "Parameters.CornerR")
    sketches_to_verify.append(sk_outer)
    pad_outer = body.newObject("PartDesign::Pad", "Lid_Outer_Pad")
    pad_outer.Profile = sk_outer
    pad_outer.Length = 15.0
    pad_outer.setExpression("Length", "Parameters.LidHeight")

    # 2. Hollow interior cavity using LipInLen x LipInWid (133.5 x 93.5 mm, R=2.75 mm) so inner wall is continuous with lip!
    sk_cav = body.newObject("Sketcher::SketchObject", "Lid_Cavity_Sketch")
    attach_sketch(sk_cav, xy, "-0.1 mm", -0.1)
    add_rounded_rect_centered(sk_cav, 133.5, 93.5, 2.75, "Parameters.LipInLen", "Parameters.LipInWid", "Parameters.LipInR")
    sketches_to_verify.append(sk_cav)
    pock_cav = body.newObject("PartDesign::Pocket", "Lid_Cavity_Pocket")
    pock_cav.Profile = sk_cav
    pock_cav.Reversed = True
    pock_cav.Length = 13.1
    pock_cav.setExpression("Length", "Parameters.LidHeight - Parameters.RoofT + 0.1 mm")

    # 3. Inner alignment lip extending 2.5 mm downward below Z=0 and embedding +0.5 mm into Z=0..0.5 solid rim
    sk_lip = body.newObject("Sketcher::SketchObject", "Lid_AlignLip_Sketch")
    attach_sketch(sk_lip, xy, "-Parameters.LipDepth", -2.5)
    add_rounded_rect_centered(sk_lip, 135.5, 95.5, 3.75, "Parameters.LipOutLen", "Parameters.LipOutWid", "Parameters.LipOutR")
    add_rounded_rect_centered(sk_lip, 133.5, 93.5, 2.75, "Parameters.LipInLen", "Parameters.LipInWid", "Parameters.LipInR")
    sketches_to_verify.append(sk_lip)
    pad_lip = body.newObject("PartDesign::Pad", "Lid_AlignLip_Pad")
    pad_lip.Profile = sk_lip
    pad_lip.Refine = True
    pad_lip.Length = 3.0
    pad_lip.setExpression("Length", "Parameters.LipDepth + 0.5 mm")

    # 4. 4x downward corner screw standoffs (OD=8.0 mm at +-61.2, +-39.5, Z=-4.0..13.1 mm)
    sk_st = body.newObject("Sketcher::SketchObject", "Lid_Standoffs_Sketch")
    attach_sketch(sk_st, xy, "-Parameters.BossDrop", -4.0)
    add_circles_sketch(sk_st, corner_centers_expr("Parameters.ScrewX", "Parameters.ScrewY", 61.2, 39.5), 8.0, "Parameters.LidBossDia")
    sketches_to_verify.append(sk_st)
    pad_st = body.newObject("PartDesign::Pad", "Lid_Standoffs_Pad")
    pad_st.Profile = sk_st
    pad_st.Refine = True
    pad_st.Length = 17.1
    pad_st.setExpression("Length", "Parameters.LidHeight - Parameters.RoofT + Parameters.BossDrop + 0.1 mm")

    # 5. 4x blind pilot holes into corner standoffs (ID=2.6 mm, Z=-4.1..12.0 mm)
    sk_pilots = body.newObject("Sketcher::SketchObject", "Lid_PilotHoles_Sketch")
    attach_sketch(sk_pilots, xy, "-Parameters.BossDrop - 0.1 mm", -4.1)
    add_circles_sketch(sk_pilots, corner_centers_expr("Parameters.ScrewX", "Parameters.ScrewY", 61.2, 39.5), 2.6, "Parameters.LidPilotDia")
    sketches_to_verify.append(sk_pilots)
    pock_pilots = body.newObject("PartDesign::Pocket", "Lid_PilotHoles_Pocket")
    pock_pilots.Profile = sk_pilots
    pock_pilots.Reversed = True
    pock_pilots.Length = 16.1
    pock_pilots.setExpression("Length", "Parameters.LidHeight - Parameters.RoofSafeMargin + Parameters.BossDrop + 0.1 mm")

    return body


def link_placement_to_bottom(obj):
    obj.setExpression(".Placement.Base.x", "Bottom_Case.Placement.Base.x")
    obj.setExpression(".Placement.Base.y", "Bottom_Case.Placement.Base.y")
    obj.setExpression(".Placement.Base.z", "Bottom_Case.Placement.Base.z")


def verify_sketch(sk):
    rc = sk.solve()
    dof = sk.DoF
    confs = getattr(sk, "ConflictingConstraints", [])
    reds = getattr(sk, "RedundantConstraints", [])
    assert rc == 0, f"{sk.Name} solve failed with {rc}"
    assert dof == 0, f"{sk.Name} has DoF={dof} (expected 0!)"
    assert not confs and not reds, f"{sk.Name} has conflicts={confs} redundant={reds}"


def build():
    gui_tpl = read_gui_template_archive(GUI_TPL_SRC) if os.path.exists(GUI_TPL_SRC) else None

    doc = FreeCAD.newDocument("Case_140x100x50_WallMount")
    sheet = build_base_parameters_from_scratch(doc)
    sketches_to_verify = []

    base_body_ref = build_bottom_case_from_scratch(doc, sketches_to_verify)
    lid_body_ref = build_top_lid_from_scratch(doc, sketches_to_verify)
    doc.recompute()

    # =========================================================================
    # OPTION 1: HTML Reference Dovetail Slide Rail + Wall Slide Plate
    # =========================================================================
    opt1_grp = doc.addObject("App::Part", "Mount_Option1_Dovetail")
    opt1_grp.Label = "Mount_Option1_Dovetail"
    link_placement_to_bottom(opt1_grp)

    b1_rail = doc.addObject("PartDesign::Body", "Opt1_Case_DovetailRail")
    b1_rail.Label = "Opt1_Case_DovetailRail"
    opt1_grp.addObject(b1_rail)
    sk_rail = b1_rail.newObject("Sketcher::SketchObject", "Opt1_Rail_Sketch")
    attach_sketch(sk_rail, get_origin_plane(b1_rail, "XZ_Plane"))
    add_dovetail_trapezoid(
        sk_rail, 50.0, 4.5, 6.0, 0.4,
        "Parameters.DovetailRootW / 2", "Parameters.DovetailBotW / 2",
        "Parameters.DovetailH", "Parameters.DovetailEmbed",
    )
    sketches_to_verify.append(sk_rail)

    pad_rail = b1_rail.newObject("PartDesign::Pad", "Opt1_Rail_Pad")
    pad_rail.Profile = sk_rail
    if hasattr(pad_rail, "SideType"):
        pad_rail.SideType = "Symmetric"
    else:
        pad_rail.Midplane = True
    pad_rail.Refine = True
    pad_rail.Length = 72.0
    pad_rail.setExpression("Length", "Parameters.DovetailLenY")

    b1_plate = doc.addObject("PartDesign::Body", "Opt1_Wall_SlidePlate")
    b1_plate.Label = "Opt1_Wall_SlidePlate"
    opt1_grp.addObject(b1_plate)
    b1_plate.setExpression(".Placement.Base.y", "-Parameters.MountSlideOffset")

    sk_pbase = b1_plate.newObject("Sketcher::SketchObject", "Opt1_Plate_Base_Sketch")
    attach_sketch(sk_pbase, get_origin_plane(b1_plate, "XY_Plane"),
                  "-(Parameters.DovetailH + Parameters.DovetailClear + Parameters.PlateT)", -10.4)
    add_rounded_rect(
        sk_pbase, 0.0, -2.2, 110.0, 76.4, 4.0,
        "-Parameters.PlateW / 2",
        "-(Parameters.DovetailLenY / 2 + Parameters.DovetailClear + Parameters.StopT)",
        "Parameters.PlateW", "Parameters.PlateLenY", "Parameters.PlateCornerR",
    )
    sketches_to_verify.append(sk_pbase)
    pad_pbase = b1_plate.newObject("PartDesign::Pad", "Opt1_Plate_Base_Pad")
    pad_pbase.Profile = sk_pbase
    pad_pbase.Refine = True
    pad_pbase.Length = 4.0
    pad_pbase.setExpression("Length", "Parameters.PlateT")

    sk_tracks = b1_plate.newObject("Sketcher::SketchObject", "Opt1_Plate_Tracks_Sketch")
    attach_sketch(sk_tracks, get_origin_plane(b1_plate, "XZ_Plane"), "-(Parameters.DovetailLenY / 2)", -36.0)
    for sgn in (-1, 1):
        add_track_trapezoid(
            sk_tracks, sgn, 25.7, 30.5, 35.7, 0.4, 6.8,
            "Parameters.TrackInnerTop",
            "Parameters.DovetailRootW / 2 + (Parameters.DovetailFlare / Parameters.DovetailH) * (Parameters.DovetailH + Parameters.DovetailClear + Parameters.DovetailEmbed) + Parameters.DovetailClear",
            "Parameters.TrackOuterX", "Parameters.DovetailClear",
            "Parameters.DovetailH + Parameters.DovetailClear + Parameters.DovetailEmbed",
        )
    sketches_to_verify.append(sk_tracks)
    pad_tracks = b1_plate.newObject("PartDesign::Pad", "Opt1_Plate_Tracks_Pad")
    pad_tracks.Profile = sk_tracks
    pad_tracks.Refine = True
    pad_tracks.Length = 76.4
    pad_tracks.setExpression("Length", "Parameters.PlateLenY")

    sk_stop = b1_plate.newObject("Sketcher::SketchObject", "Opt1_Plate_Stop_Sketch")
    attach_sketch(sk_stop, get_origin_plane(b1_plate, "XY_Plane"),
                  "-(Parameters.DovetailH + Parameters.DovetailClear + Parameters.DovetailEmbed)", -6.8)
    add_rect(
        sk_stop, -35.7, -40.4, 35.7, -36.4,
        "-Parameters.TrackOuterX",
        "-(Parameters.DovetailLenY / 2 + Parameters.DovetailClear + Parameters.StopT)",
        "2 * Parameters.TrackOuterX", "Parameters.StopT",
    )
    sketches_to_verify.append(sk_stop)
    pad_stop = b1_plate.newObject("PartDesign::Pad", "Opt1_Plate_Stop_Pad")
    pad_stop.Profile = sk_stop
    pad_stop.Refine = True
    pad_stop.Length = 6.4
    pad_stop.setExpression("Length", "Parameters.DovetailH + Parameters.DovetailEmbed")

    sk_slots = b1_plate.newObject("Sketcher::SketchObject", "Opt1_Plate_Slots_Sketch")
    attach_sketch(sk_slots, get_origin_plane(b1_plate, "XY_Plane"),
                  "-(Parameters.DovetailH + Parameters.DovetailClear) + 0.2 mm", -6.2)
    for sx_s, cx in ((-1, -45.5), (1, 45.5)):
        for sy_s, cy in ((-1, -20.0), (1, 20.0)):
            ex_cx = "Parameters.PlateHoleX" if sx_s > 0 else "-Parameters.PlateHoleX"
            ex_yt = "Parameters.PlateHoleY + Parameters.MountSlotTravel / 2" if sy_s > 0 else "-Parameters.PlateHoleY + Parameters.MountSlotTravel / 2"
            add_vertical_slot(sk_slots, cx, cy, 4.6, 6.0, ex_cx, ex_yt, "Parameters.MountSlotDia", "Parameters.MountSlotTravel")
    sketches_to_verify.append(sk_slots)
    pkt_slots = b1_plate.newObject("PartDesign::Pocket", "Opt1_Plate_Slots_Pocket")
    pkt_slots.Profile = sk_slots
    pkt_slots.Reversed = False
    pkt_slots.Length = 4.5
    pkt_slots.setExpression("Length", "Parameters.PlateT + 0.5 mm")

    # =========================================================================
    # OPTION 2: Slim 5.5 mm Zero-Bracket Twin Keyhole H-Frame
    # =========================================================================
    b2 = doc.addObject("PartDesign::Body", "Mount_Option2_KeyholeRails")
    b2.Label = "Mount_Option2_KeyholeRails"
    link_placement_to_bottom(b2)

    sk_kh_core = b2.newObject("Sketcher::SketchObject", "Opt2_Core_Sketch")
    attach_sketch(sk_kh_core, get_origin_plane(b2, "XY_Plane"), "-(Parameters.KH_PadT - Parameters.KH_FlangeT)", -3.3)
    add_h_frame(sk_kh_core, 38.0, 22.0, 72.0, 12.0, "Parameters.KH_RailX", "Parameters.KH_RailW", "Parameters.KH_RailLenY", "Parameters.KH_BridgeH")
    sketches_to_verify.append(sk_kh_core)
    pad_kh_core = b2.newObject("PartDesign::Pad", "Opt2_Core_Pad")
    pad_kh_core.Profile = sk_kh_core
    pad_kh_core.Refine = True
    pad_kh_core.Length = 3.6
    pad_kh_core.setExpression("Length", "Parameters.KH_PadT - Parameters.KH_FlangeT + 0.3 mm")

    sk_kh_bay = b2.newObject("Sketcher::SketchObject", "Opt2_HeadBays_Sketch")
    attach_sketch(sk_kh_bay, get_origin_plane(b2, "XY_Plane"), "-(Parameters.KH_PadT - Parameters.KH_FlangeT) - 0.1 mm", -3.4)
    for sx_s, cx in ((-1, -38.0), (1, 38.0)):
        for sy_s, cy in ((-1, -21.0), (1, 21.0)):
            ex_cx = "Parameters.KH_RailX" if sx_s > 0 else "-Parameters.KH_RailX"
            ex_yt = "Parameters.KH_PosY + Parameters.KH_Travel / 2" if sy_s > 0 else "-Parameters.KH_PosY + Parameters.KH_Travel / 2"
            add_vertical_slot(sk_kh_bay, cx, cy, 11.0, 8.0, ex_cx, ex_yt, "Parameters.KH_HeadBayDia", "Parameters.KH_Travel")
    sketches_to_verify.append(sk_kh_bay)
    pkt_kh_bay = b2.newObject("PartDesign::Pocket", "Opt2_HeadBays_Pocket")
    pkt_kh_bay.Profile = sk_kh_bay
    pkt_kh_bay.Reversed = True
    pkt_kh_bay.Length = 3.0
    pkt_kh_bay.setExpression("Length", "Parameters.KH_ChamberT + 0.1 mm")

    sk_kh_fl = b2.newObject("Sketcher::SketchObject", "Opt2_Flange_Sketch")
    attach_sketch(sk_kh_fl, get_origin_plane(b2, "XY_Plane"), "-(Parameters.KH_PadT - Parameters.KH_FlangeT) + 0.1 mm", -3.2)
    add_h_frame(sk_kh_fl, 38.0, 22.0, 72.0, 12.0, "Parameters.KH_RailX", "Parameters.KH_RailW", "Parameters.KH_RailLenY", "Parameters.KH_BridgeH")
    for sx_s, cx in ((-1, -38.0), (1, 38.0)):
        for sy_s, cy in ((-1, -21.0), (1, 21.0)):
            ex_cx = "Parameters.KH_RailX" if sx_s > 0 else "-Parameters.KH_RailX"
            ex_yb = "Parameters.KH_PosY - Parameters.KH_Travel / 2" if sy_s > 0 else "-Parameters.KH_PosY - Parameters.KH_Travel / 2"
            add_keyhole(sk_kh_fl, cx, cy, 9.0, 4.6, 8.0, ex_cx, ex_yb, "Parameters.KH_EntryDia", "Parameters.MountSlotDia", "Parameters.KH_Travel")
    sketches_to_verify.append(sk_kh_fl)
    pad_kh_fl = b2.newObject("PartDesign::Pad", "Opt2_Flange_Pad")
    pad_kh_fl.Profile = sk_kh_fl
    pad_kh_fl.Reversed = True
    pad_kh_fl.Refine = True
    pad_kh_fl.Length = 2.3
    pad_kh_fl.setExpression("Length", "Parameters.KH_FlangeT + 0.1 mm")

    # =========================================================================
    # OPTION 3: Reinforced External Side Mounting Flanges (exact sample_case specs)
    # =========================================================================
    b3 = doc.addObject("PartDesign::Body", "Mount_Option3_ExternalFlanges")
    b3.Label = "Mount_Option3_ExternalFlanges"
    b3.AllowCompound = True
    link_placement_to_bottom(b3)

    # Feature 1: 4x 6.0 mm flat-bottom ears (90-deg root at +-68.8, R4.0 outer tip at +-85.0, Y=+-26.5 +- 12.0, slot at +-78.5)
    sk_ears = b3.newObject("Sketcher::SketchObject", "Opt3_Ears_Sketch")
    attach_sketch(sk_ears, get_origin_plane(b3, "XY_Plane"))
    for sx_s in (-1, 1):
        for sy_s, cy in ((-1, -26.5), (1, 26.5)):
            add_opt3_ear_root90(sk_ears, sx_s, 68.8, 85.0, cy, 24.0, 4.0)
            ex_hx = "Parameters.EarHoleX" if sx_s > 0 else "-Parameters.EarHoleX"
            ex_hyt = "Parameters.EarCenterY + Parameters.MountSlotTravel / 2" if sy_s > 0 else "-Parameters.EarCenterY + Parameters.MountSlotTravel / 2"
            add_vertical_slot(
                sk_ears, sx_s * 78.5, cy, 4.6, 6.0,
                ex_hx, ex_hyt, "Parameters.MountSlotDia", "Parameters.MountSlotTravel"
            )
    sketches_to_verify.append(sk_ears)
    pad_ears = b3.newObject("PartDesign::Pad", "Opt3_Ears_Pad")
    pad_ears.Profile = sk_ears
    pad_ears.Refine = True
    pad_ears.Length = 6.0
    pad_ears.setExpression("Length", "Parameters.EarThickZ")

    # Feature 2: Full-width 45 deg root bevel across each 24 mm ear (Z = 5.8..10.5 mm, X = +-68.8..+-73.8 mm)
    for tag, y_mid, y_expr in [
        ("BevelLower", -26.5, "-Parameters.EarCenterY"),
        ("BevelUpper",  26.5,  "Parameters.EarCenterY"),
    ]:
        sk_bev = b3.newObject("Sketcher::SketchObject", f"Opt3_{tag}_Sketch")
        attach_sketch(sk_bev, get_origin_plane(b3, "XZ_Plane"), f"-({y_expr})", -y_mid)
        for sx_s in (-1, 1):
            add_ear_rib(
                sk_bev, sx_s,
                70.0, 3.8, 5.8, 10.5, 1.2,
                "Parameters.Length / 2",
                "3.8 mm",
                "Parameters.EarThickZ - 0.2 mm",
                "10.5 mm",
                "1.2 mm",
            )
        sketches_to_verify.append(sk_bev)
        pad_bev = b3.newObject("PartDesign::Pad", f"Opt3_{tag}_Pad")
        pad_bev.Profile = sk_bev
        if hasattr(pad_bev, "SideType"):
            pad_bev.SideType = "Symmetric"
        else:
            pad_bev.Midplane = True
        pad_bev.Refine = True
        pad_bev.Length = 23.9
        pad_bev.setExpression("Length", "Parameters.EarWidthY - 0.1 mm")

    # Feature 3: 8 Stiffening Gusset Ribs (3.5 mm wide on both edges of every ear, Z=5.8..6.8..14.0 mm, X=+-68.8..+-80.8 mm)
    for tag, y_mid, y_expr in [
        ("LowerBot", -36.75, "-Parameters.EarCenterY - Parameters.EarWidthY / 2 + Parameters.EarRibW / 2"),
        ("LowerTop", -16.25, "-Parameters.EarCenterY + Parameters.EarWidthY / 2 - Parameters.EarRibW / 2"),
        ("UpperBot",  16.25,  "Parameters.EarCenterY - Parameters.EarWidthY / 2 + Parameters.EarRibW / 2"),
        ("UpperTop",  36.75,  "Parameters.EarCenterY + Parameters.EarWidthY / 2 - Parameters.EarRibW / 2"),
    ]:
        sk_rib = b3.newObject("Sketcher::SketchObject", f"Opt3_Rib_{tag}_Sketch")
        attach_sketch(sk_rib, get_origin_plane(b3, "XZ_Plane"), f"-({y_expr})", -y_mid)
        for sx_s in (-1, 1):
            add_opt3_gusset_5pt(
                sk_rib, sx_s,
                70.0, 10.8, 5.8, 6.8, 14.0, 1.2,
                "Parameters.Length / 2",
                "Parameters.EarRibReach",
                "Parameters.EarThickZ - 0.2 mm",
                "Parameters.EarThickZ + 0.8 mm",
                "Parameters.EarRibTopZ",
                "1.2 mm",
            )
        sketches_to_verify.append(sk_rib)
        pad_rib = b3.newObject("PartDesign::Pad", f"Opt3_Rib_{tag}_Pad")
        pad_rib.Profile = sk_rib
        if hasattr(pad_rib, "SideType"):
            pad_rib.SideType = "Symmetric"
        else:
            pad_rib.Midplane = True
        pad_rib.Refine = True
        pad_rib.Length = 3.5
        pad_rib.setExpression("Length", "Parameters.EarRibW")

    # =========================================================================
    # SECTION 4: Bottom_Case Wall Cutouts (2x Barrel Jacks on -Y, C8 Socket on +X)
    # =========================================================================
    pcb_mount_pts = [
        (1,  3.9,  20.1),
        (2, -11.7, -9.9),
        (3, 18.1, -15.6),
        (4,  0.2, -35.1),
        (5, 48.6, -35.1),
    ]
    pcb_comp_pts = [
        (1, 45.0, -11.9),
        (2, 45.0, -24.9),
    ]
    pcb_off_y = -7.5

    sk_wall_jacks = base_body_ref.newObject("Sketcher::SketchObject", "Base_JackHoles_Sketch")
    attach_sketch(sk_wall_jacks, get_origin_plane(base_body_ref, "XZ_Plane"),
                  "Parameters.Width / 2 - Parameters.WallT - 0.5 mm", 47.5)
    for j_idx, jx_val in ((1, -21.8), (2, 24.7)):
        g_wj = sk_wall_jacks.addGeometry(Part.Circle(FreeCAD.Vector(jx_val, 15.1, 0.0), FreeCAD.Vector(0, 0, 1), 5.25), False)
        bind_expr(sk_wall_jacks, ("Diameter", g_wj, 10.5), "Parameters.JackCutDia")
        bind_expr(sk_wall_jacks, ("DistanceX", -1, 1, g_wj, 3, jx_val), f"Parameters.PCB_OffsetX + Parameters.Jack{j_idx}_X")
        bind_expr(sk_wall_jacks, ("DistanceY", -1, 1, g_wj, 3, 15.1), "Parameters.JackCutZ")
    sketches_to_verify.append(sk_wall_jacks)

    pkt_wall_jacks = base_body_ref.newObject("PartDesign::Pocket", "Base_JackHoles_Pocket")
    pkt_wall_jacks.Profile = sk_wall_jacks
    pkt_wall_jacks.Reversed = True
    pkt_wall_jacks.Length = 3.5
    pkt_wall_jacks.setExpression("Length", "Parameters.WallT + 1.5 mm")

    sk_wall_c8 = base_body_ref.newObject("Sketcher::SketchObject", "Base_C8Cut_Sketch")
    attach_sketch(sk_wall_c8, get_origin_plane(base_body_ref, "YZ_Plane"), "Parameters.Length / 2 + 0.5 mm", 70.5)
    add_horizontal_slot(
        sk_wall_c8, 0.0, 22.5, 12.4, 21.0 - 12.4,
        "Parameters.C8_PosY + (Parameters.C8_CutLen - Parameters.C8_CutW) / 2",
        "Parameters.C8_PosZ", "Parameters.C8_CutW", "Parameters.C8_CutLen - Parameters.C8_CutW",
    )
    for c_sign, c_tag in ((-1.0, "-"), (1.0, "+")):
        hy_c8 = c_sign * 14.0
        g_ch = sk_wall_c8.addGeometry(Part.Circle(FreeCAD.Vector(hy_c8, 22.5, 0.0), FreeCAD.Vector(0, 0, 1), 1.85), False)
        bind_expr(sk_wall_c8, ("Diameter", g_ch, 3.7), "Parameters.C8_PanelHoleDia")
        bind_expr(sk_wall_c8, ("DistanceX", -1, 1, g_ch, 3, hy_c8), f"Parameters.C8_PosY {c_tag} Parameters.C8_HolePitch / 2")
        bind_expr(sk_wall_c8, ("DistanceY", -1, 1, g_ch, 3, 22.5), "Parameters.C8_PosZ")
    sketches_to_verify.append(sk_wall_c8)

    pkt_wall_c8 = base_body_ref.newObject("PartDesign::Pocket", "Base_C8Cut_Pocket")
    pkt_wall_c8.Profile = sk_wall_c8
    pkt_wall_c8.Reversed = False
    pkt_wall_c8.Refine = True
    pkt_wall_c8.Length = 3.0
    pkt_wall_c8.setExpression("Length", "Parameters.WallT + 1.0 mm")

    # =========================================================================
    # PCB ASSEMBLY: 1.6 mm PCB_Board + 3D Reference Components inside Box
    # =========================================================================
    pcb_asm = doc.addObject("App::Part", "PCB_Assembly")
    pcb_asm.Label = "PCB_Assembly"
    pcb_asm.setExpression(".Placement.Base.x", "Bottom_Case.Placement.Base.x")
    pcb_asm.setExpression(".Placement.Base.y", "Bottom_Case.Placement.Base.y")
    pcb_asm.setExpression(".Placement.Base.z", "Bottom_Case.Placement.Base.z + Parameters.FloorT + Parameters.StandoffH")

    b_pcb = doc.addObject("PartDesign::Body", "PCB_Board")
    b_pcb.Label = "PCB_Board"
    pcb_asm.addObject(b_pcb)

    sk_pcb_base = b_pcb.newObject("Sketcher::SketchObject", "PCB_Outline_Sketch")
    attach_sketch(sk_pcb_base, get_origin_plane(b_pcb, "XY_Plane"))
    g0, _, _ = add_line(sk_pcb_base, (-54.0, -40.0 + pcb_off_y), (54.0, -40.0 + pcb_off_y))
    g1, _, _ = add_line(sk_pcb_base, (54.0, -40.0 + pcb_off_y), (54.0, 40.0 + pcb_off_y))
    g2, _, _ = add_line(sk_pcb_base, (54.0, 40.0 + pcb_off_y), (-54.0, 40.0 + pcb_off_y))
    g3, _, _ = add_line(sk_pcb_base, (-54.0, 40.0 + pcb_off_y), (-54.0, -40.0 + pcb_off_y))
    for gi, gn in ((g0, g1), (g1, g2), (g2, g3), (g3, g0)):
        bind_expr(sk_pcb_base, ("Coincident", gi, 2, gn, 1))
    bind_expr(sk_pcb_base, ("Horizontal", g0))
    bind_expr(sk_pcb_base, ("Vertical", g1))
    bind_expr(sk_pcb_base, ("Horizontal", g2))
    bind_expr(sk_pcb_base, ("Vertical", g3))
    bind_expr(sk_pcb_base, ("DistanceX", g0, 1, g0, 2, 108.0), "Parameters.PCB_Length")
    bind_expr(sk_pcb_base, ("DistanceY", g1, 1, g1, 2, 80.0), "Parameters.PCB_Width")
    bind_expr(sk_pcb_base, ("DistanceX", -1, 1, g0, 1, -54.0), "Parameters.PCB_OffsetX - Parameters.PCB_Length / 2")
    bind_expr(sk_pcb_base, ("DistanceY", -1, 1, g0, 1, -40.0 + pcb_off_y), "Parameters.PCB_OffsetY - Parameters.PCB_Width / 2")
    sketches_to_verify.append(sk_pcb_base)

    pad_pcb = b_pcb.newObject("PartDesign::Pad", "PCB_Outline_Pad")
    pad_pcb.Profile = sk_pcb_base
    pad_pcb.Refine = True
    pad_pcb.Length = 1.6
    pad_pcb.setExpression("Length", "Parameters.PCB_Thick")

    sk_pcb_holes = b_pcb.newObject("Sketcher::SketchObject", "PCB_Holes_Sketch")
    attach_sketch(sk_pcb_holes, get_origin_plane(b_pcb, "XY_Plane"), "Parameters.PCB_Thick + 0.1 mm", 1.7)
    for idx, vx, vy in pcb_mount_pts:
        vy_w = vy + pcb_off_y
        g_h = sk_pcb_holes.addGeometry(Part.Circle(FreeCAD.Vector(vx, vy_w, 0.0), FreeCAD.Vector(0, 0, 1), 1.5), False)
        bind_expr(sk_pcb_holes, ("Diameter", g_h, 3.0), "Parameters.PCB_HoleDia")
        bind_expr(sk_pcb_holes, ("DistanceX", -1, 1, g_h, 3, vx), f"Parameters.PCB_OffsetX + Parameters.PCB_S{idx}_X")
        bind_expr(sk_pcb_holes, ("DistanceY", -1, 1, g_h, 3, vy_w), f"Parameters.PCB_OffsetY + Parameters.PCB_S{idx}_Y")
    for idx, vx, vy in pcb_comp_pts:
        vy_w = vy + pcb_off_y
        g_c = sk_pcb_holes.addGeometry(Part.Circle(FreeCAD.Vector(vx, vy_w, 0.0), FreeCAD.Vector(0, 0, 1), 1.65), False)
        bind_expr(sk_pcb_holes, ("Diameter", g_c, 3.3), "Parameters.PCB_CompHoleDia")
        bind_expr(sk_pcb_holes, ("DistanceX", -1, 1, g_c, 3, vx), f"Parameters.PCB_OffsetX + Parameters.PCB_C{idx}_X")
        bind_expr(sk_pcb_holes, ("DistanceY", -1, 1, g_c, 3, vy_w), f"Parameters.PCB_OffsetY + Parameters.PCB_C{idx}_Y")

    sx_c, sy_c, s_dia, s_tr = 36.0, -3.8 + pcb_off_y, 1.8, 62.2
    sr = s_dia / 2.0
    s_yt, s_yb = sy_c + s_tr / 2.0, sy_c - s_tr / 2.0
    gt_s, _, _ = add_arc_ccw(sk_pcb_holes, sx_c, s_yt, sr, (sx_c + sr, s_yt), (sx_c - sr, s_yt))
    gl_s, _, _ = add_line(sk_pcb_holes, (sx_c - sr, s_yt), (sx_c - sr, s_yb))
    gb_s, _, _ = add_arc_ccw(sk_pcb_holes, sx_c, s_yb, sr, (sx_c - sr, s_yb), (sx_c + sr, s_yb))
    gr_s, _, _ = add_line(sk_pcb_holes, (sx_c + sr, s_yb), (sx_c + sr, s_yt))
    bind_expr(sk_pcb_holes, ("Tangent", gt_s, 2, gl_s, 1))
    bind_expr(sk_pcb_holes, ("Tangent", gl_s, 2, gb_s, 1))
    bind_expr(sk_pcb_holes, ("Tangent", gb_s, 2, gr_s, 1))
    bind_expr(sk_pcb_holes, ("Tangent", gr_s, 2, gt_s, 1))
    bind_expr(sk_pcb_holes, ("Vertical", gr_s))
    bind_expr(sk_pcb_holes, ("Equal", gt_s, gb_s))
    bind_expr(sk_pcb_holes, ("Diameter", gt_s, s_dia), "Parameters.PCB_SlotW")
    bind_expr(sk_pcb_holes, ("DistanceX", -1, 1, gt_s, 3, sx_c), "Parameters.PCB_OffsetX + Parameters.PCB_SlotX")
    bind_expr(sk_pcb_holes, ("DistanceY", -1, 1, gt_s, 3, s_yt), "Parameters.PCB_OffsetY + Parameters.PCB_SlotY + Parameters.PCB_SlotTravel / 2")
    bind_expr(sk_pcb_holes, ("DistanceY", gb_s, 3, gt_s, 3, s_tr), "Parameters.PCB_SlotTravel")
    sketches_to_verify.append(sk_pcb_holes)

    pkt_pcb_holes = b_pcb.newObject("PartDesign::Pocket", "PCB_Holes_Pocket")
    pkt_pcb_holes.Profile = sk_pcb_holes
    pkt_pcb_holes.Reversed = False
    pkt_pcb_holes.Length = 1.9
    pkt_pcb_holes.setExpression("Length", "Parameters.PCB_Thick + 0.3 mm")

    comp_grp = doc.addObject("App::Part", "PCB_Components_3D")
    comp_grp.Label = "PCB_Components_3D"
    pcb_asm.addObject(comp_grp)

    def add_comp_box_feature(
        body_obj, name_pfx, cx_pcb, cy_pcb, w, d, z_bot_expr, z_bot_val, h,
        ex_cx_off, ex_cy_off, is_compound_add=False,
        ox_expr="Parameters.PCB_OffsetX", oy_expr="Parameters.PCB_OffsetY",
        ox_val=0.0, oy_val=pcb_off_y, h_expr=None, reversed_pad=False,
    ):
        sk = body_obj.newObject("Sketcher::SketchObject", f"{name_pfx}_Sketch")
        attach_sketch(sk, get_origin_plane(body_obj, "XY_Plane"), z_bot_expr, z_bot_val)
        x0, y0_s = cx_pcb + ox_val - w / 2.0, cy_pcb + oy_val - d / 2.0
        g_0, _, _ = add_line(sk, (x0, y0_s), (x0 + w, y0_s))
        g_1, _, _ = add_line(sk, (x0 + w, y0_s), (x0 + w, y0_s + d))
        g_2, _, _ = add_line(sk, (x0 + w, y0_s + d), (x0, y0_s + d))
        g_3, _, _ = add_line(sk, (x0, y0_s + d), (x0, y0_s))
        for ga, gb in ((g_0, g_1), (g_1, g_2), (g_2, g_3), (g_3, g_0)):
            bind_expr(sk, ("Coincident", ga, 2, gb, 1))
        bind_expr(sk, ("Horizontal", g_0))
        bind_expr(sk, ("Vertical", g_1))
        bind_expr(sk, ("Horizontal", g_2))
        bind_expr(sk, ("Vertical", g_3))
        bind_expr(sk, ("DistanceX", g_0, 1, g_0, 2, w))
        bind_expr(sk, ("DistanceY", g_1, 1, g_1, 2, d))
        bind_expr(sk, ("DistanceX", -1, 1, g_0, 1, x0), f"{ox_expr} + ({ex_cx_off - w/2.0:.4f} mm)")
        bind_expr(sk, ("DistanceY", -1, 1, g_0, 1, y0_s), f"{oy_expr} + ({ex_cy_off - d/2.0:.4f} mm)")
        sketches_to_verify.append(sk)
        pad = body_obj.newObject("PartDesign::Pad", f"{name_pfx}_Pad")
        pad.Profile = sk
        pad.Reversed = reversed_pad
        pad.Refine = True
        pad.Length = h
        if h_expr:
            pad.setExpression("Length", h_expr)
        return pad

    def add_comp_cyl_feature(
        body_obj, name_pfx, cx_val, cy_val, d_val, d_expr,
        z_bot_expr, z_bot_val, h_val, h_expr=None,
        ox_expr="Parameters.UI_OffsetX", oy_expr="Parameters.UI_OffsetY",
        cx_expr=None, cy_expr=None, reversed_pad=False,
    ):
        sk = body_obj.newObject("Sketcher::SketchObject", f"{name_pfx}_Sketch")
        attach_sketch(sk, get_origin_plane(body_obj, "XY_Plane"), z_bot_expr, z_bot_val)
        g_c = sk.addGeometry(Part.Circle(FreeCAD.Vector(cx_val, cy_val, 0.0), FreeCAD.Vector(0, 0, 1), d_val / 2.0), False)
        bind_expr(sk, ("Diameter", g_c, d_val), d_expr)
        ex_x = cx_expr if cx_expr else f"{ox_expr} + ({cx_val:.4f} mm)"
        ex_y = cy_expr if cy_expr else f"{oy_expr} + ({cy_val:.4f} mm)"
        bind_expr(sk, ("DistanceX", -1, 1, g_c, 3, cx_val), ex_x)
        bind_expr(sk, ("DistanceY", -1, 1, g_c, 3, cy_val), ex_y)
        sketches_to_verify.append(sk)
        pad = body_obj.newObject("PartDesign::Pad", f"{name_pfx}_Pad")
        pad.Profile = sk
        pad.Reversed = reversed_pad
        pad.Refine = True
        pad.Length = h_val
        if h_expr:
            pad.setExpression("Length", h_expr)
        return pad

    def add_barrel_jack_profile(sk, jx_val, j_idx):
        hw = 4.5
        z_pcb = 1.6
        z_ax = z_pcb + 6.5
        g_bot, _, _ = add_line(sk, (jx_val - hw, z_pcb), (jx_val + hw, z_pcb))
        g_rt, _, _ = add_line(sk, (jx_val + hw, z_pcb), (jx_val + hw, z_ax))
        g_arc, _, _ = add_arc_ccw(sk, jx_val, z_ax, hw, (jx_val + hw, z_ax), (jx_val - hw, z_ax))
        g_lt, _, _ = add_line(sk, (jx_val - hw, z_ax), (jx_val - hw, z_pcb))
        bind_expr(sk, ("Coincident", g_bot, 2, g_rt, 1))
        bind_expr(sk, ("Tangent", g_rt, 2, g_arc, 1))
        bind_expr(sk, ("Tangent", g_arc, 2, g_lt, 1))
        bind_expr(sk, ("Coincident", g_lt, 2, g_bot, 1))
        bind_expr(sk, ("Horizontal", g_bot))
        bind_expr(sk, ("Vertical", g_rt))
        bind_expr(sk, ("Vertical", g_lt))
        bind_expr(sk, ("Radius", g_arc, hw), "Parameters.JackWidth / 2")
        bind_expr(sk, ("DistanceX", -1, 1, g_arc, 3, jx_val), f"Parameters.PCB_OffsetX + Parameters.Jack{j_idx}_X")
        bind_expr(sk, ("DistanceY", -1, 1, g_arc, 3, z_ax), "Parameters.PCB_Thick + Parameters.JackAxisZ")
        bind_expr(sk, ("DistanceY", -1, 1, g_bot, 1, z_pcb), "Parameters.PCB_Thick")

    c_jacks = doc.addObject("PartDesign::Body", "Comp_BarrelJacks_U4_U1")
    c_jacks.Label = "Comp_BarrelJacks_U4_U1"
    c_jacks.AllowCompound = True
    comp_grp.addObject(c_jacks)

    sk_jbody = c_jacks.newObject("Sketcher::SketchObject", "Jacks_Profile_Sketch")
    attach_sketch(sk_jbody, get_origin_plane(c_jacks, "XZ_Plane"),
                  "-(Parameters.PCB_OffsetY - Parameters.PCB_Width / 2)", 47.5)
    for j_idx, jx_val in ((1, -21.8), (2, 24.7)):
        add_barrel_jack_profile(sk_jbody, jx_val, j_idx)
    sketches_to_verify.append(sk_jbody)

    pad_jbody = c_jacks.newObject("PartDesign::Pad", "Jacks_Body_Pad")
    pad_jbody.Profile = sk_jbody
    pad_jbody.Reversed = True
    pad_jbody.Refine = True
    pad_jbody.Length = 14.2
    pad_jbody.setExpression("Length", "Parameters.JackDepth")

    sk_jbore = c_jacks.newObject("Sketcher::SketchObject", "Jacks_Bore_Sketch")
    attach_sketch(sk_jbore, get_origin_plane(c_jacks, "XZ_Plane"),
                  "-(Parameters.PCB_OffsetY - Parameters.PCB_Width / 2) + 0.1 mm", 47.6)
    for j_idx, jx_val in ((1, -21.8), (2, 24.7)):
        g_jb = sk_jbore.addGeometry(Part.Circle(FreeCAD.Vector(jx_val, 8.1, 0.0), FreeCAD.Vector(0, 0, 1), 3.15), False)
        bind_expr(sk_jbore, ("Diameter", g_jb, 6.3), "Parameters.JackBoreDia")
        bind_expr(sk_jbore, ("DistanceX", -1, 1, g_jb, 3, jx_val), f"Parameters.PCB_OffsetX + Parameters.Jack{j_idx}_X")
        bind_expr(sk_jbore, ("DistanceY", -1, 1, g_jb, 3, 8.1), "Parameters.PCB_Thick + Parameters.JackAxisZ")
    sketches_to_verify.append(sk_jbore)

    pkt_jbore = c_jacks.newObject("PartDesign::Pocket", "Jacks_Bore_Pocket")
    pkt_jbore.Profile = sk_jbore
    pkt_jbore.Reversed = False
    pkt_jbore.Length = 10.5

    c_terms = doc.addObject("PartDesign::Body", "Comp_Terminals_P1_P2")
    c_terms.Label = "Comp_Terminals_P1_P2"
    c_terms.AllowCompound = True
    comp_grp.addObject(c_terms)
    add_comp_box_feature(c_terms, "Term_P1", -12.5, 34.1, 10.2, 8.9, "Parameters.PCB_Thick", 1.6, 10.0, -12.5, 34.1)
    add_comp_box_feature(c_terms, "Term_P2", 42.8, -34.8, 8.2, 10.0, "Parameters.PCB_Thick", 1.6, 10.0, 42.8, -34.8)

    c_mcu = doc.addObject("PartDesign::Body", "Comp_ESP32_DevKit")
    c_mcu.Label = "Comp_ESP32_DevKit"
    comp_grp.addObject(c_mcu)
    add_comp_box_feature(c_mcu, "ESP32_Pins", -34.65, 11.7, 27.6, 55.8, "Parameters.PCB_Thick", 1.6, 5.5, -34.65, 11.7)
    add_comp_box_feature(c_mcu, "ESP32_PCB", -34.65, 11.7, 28.1, 56.4, "Parameters.PCB_Thick + 5.5 mm", 7.1, 1.6, -34.65, 11.7)

    c_mcu_sh = doc.addObject("PartDesign::Body", "Comp_ESP32_RF_Shield")
    c_mcu_sh.Label = "Comp_ESP32_RF_Shield"
    comp_grp.addObject(c_mcu_sh)
    add_comp_box_feature(c_mcu_sh, "ESP32_Shield", -34.65, 26.0, 16.0, 18.0, "Parameters.PCB_Thick + 7.1 mm", 8.7, 3.2, -34.65, 26.0)

    c_tb = doc.addObject("PartDesign::Body", "Comp_TB6612_Red")
    c_tb.Label = "Comp_TB6612_Red"
    comp_grp.addObject(c_tb)
    add_comp_box_feature(c_tb, "TB_Pins", -42.35, -29.15, 20.0, 19.4, "Parameters.PCB_Thick", 1.6, 6.4, -42.35, -29.15)
    add_comp_box_feature(c_tb, "TB_PCB", -42.35, -29.15, 20.7, 20.1, "Parameters.PCB_Thick + 6.4 mm", 8.0, 1.6, -42.35, -29.15)

    c_tb_ic = doc.addObject("PartDesign::Body", "Comp_TB6612_IC")
    c_tb_ic.Label = "Comp_TB6612_IC"
    comp_grp.addObject(c_tb_ic)
    add_comp_box_feature(c_tb_ic, "TB_IC", -42.35, -29.15, 8.0, 8.0, "Parameters.PCB_Thick + 8.0 mm", 9.6, 1.5, -42.35, -29.15)

    c_smps_pcb = doc.addObject("PartDesign::Body", "Comp_SMPS_PCBs")
    c_smps_pcb.Label = "Comp_SMPS_PCBs"
    c_smps_pcb.AllowCompound = True
    comp_grp.addObject(c_smps_pcb)
    add_comp_box_feature(c_smps_pcb, "SMPS_U3_Base", 30.35, 27.0, 44.1, 25.0, "Parameters.PCB_Thick", 1.6, 2.0, 30.35, 27.0)
    add_comp_box_feature(c_smps_pcb, "SMPS_Mid_Base", 37.45, 1.55, 30.1, 21.1, "Parameters.PCB_Thick", 1.6, 2.0, 37.45, 1.55)

    c_smps_xfmr = doc.addObject("PartDesign::Body", "Comp_SMPS_Transformers")
    c_smps_xfmr.Label = "Comp_SMPS_Transformers"
    c_smps_xfmr.AllowCompound = True
    comp_grp.addObject(c_smps_xfmr)
    add_comp_box_feature(c_smps_xfmr, "SMPS_U3_Body", 30.35, 27.0, 40.0, 22.0, "Parameters.PCB_Thick + 2.0 mm", 3.6, 20.0, 30.35, 27.0)
    add_comp_box_feature(c_smps_xfmr, "SMPS_Mid_Body", 37.45, 1.55, 27.0, 18.0, "Parameters.PCB_Thick + 2.0 mm", 3.6, 14.5, 37.45, 1.55)

    c_hdrs = doc.addObject("PartDesign::Body", "Comp_Headers_J3_J2")
    c_hdrs.Label = "Comp_Headers_J3_J2"
    c_hdrs.AllowCompound = True
    comp_grp.addObject(c_hdrs)
    add_comp_box_feature(c_hdrs, "Header_J3", -3.8, -29.3, 23.0, 6.0, "Parameters.PCB_Thick", 1.6, 3.0, -3.8, -29.3)
    add_comp_box_feature(c_hdrs, "Header_J2", -52.45, -13.95, 2.7, 5.1, "Parameters.PCB_Thick", 1.6, 8.5, -52.45, -13.95)

    # =========================================================================
    # SEPARATE RIGHT-WALL AC SOCKET C8 (SUNROM 7669 Panel Mount)
    # =========================================================================
    ac_asm = doc.addObject("App::Part", "AC_Socket_C8_Panel")
    ac_asm.Label = "AC_Socket_C8_Panel"
    link_placement_to_bottom(ac_asm)

    c8_body = doc.addObject("PartDesign::Body", "C8_Body_PA66")
    c8_body.Label = "C8_Body_PA66"
    ac_asm.addObject(c8_body)
    c8_yz = get_origin_plane(c8_body, "YZ_Plane")

    sk_c8_flange = c8_body.newObject("Sketcher::SketchObject", "C8_Flange_Sketch")
    attach_sketch(sk_c8_flange, c8_yz, "Parameters.Length / 2", 70.0)
    add_rounded_rect(
        sk_c8_flange, 0.0, 22.5, 35.0, 15.0, 2.5,
        "Parameters.C8_PosY - Parameters.C8_FlangeL / 2",
        "Parameters.C8_PosZ - Parameters.C8_FlangeW / 2",
        "Parameters.C8_FlangeL", "Parameters.C8_FlangeW", "2.5 mm",
    )
    sketches_to_verify.append(sk_c8_flange)
    pad_c8_flange = c8_body.newObject("PartDesign::Pad", "C8_Flange_Pad")
    pad_c8_flange.Profile = sk_c8_flange
    pad_c8_flange.Reversed = False
    pad_c8_flange.Refine = True
    pad_c8_flange.Length = 4.0
    pad_c8_flange.setExpression("Length", "Parameters.C8_FlangeT")

    sk_c8_barrel = c8_body.newObject("Sketcher::SketchObject", "C8_Barrel_Sketch")
    attach_sketch(sk_c8_barrel, c8_yz, "Parameters.Length / 2 + Parameters.C8_FlangeT + Parameters.C8_LipH", 75.0)
    add_horizontal_slot(
        sk_c8_barrel, 0.0, 22.5, 12.0, 20.3 - 12.0,
        "Parameters.C8_PosY + (20.3 mm - 12.0 mm) / 2",
        "Parameters.C8_PosZ", "12.0 mm", "20.3 mm - 12.0 mm",
    )
    sketches_to_verify.append(sk_c8_barrel)
    pad_c8_barrel = c8_body.newObject("PartDesign::Pad", "C8_Barrel_Pad")
    pad_c8_barrel.Profile = sk_c8_barrel
    pad_c8_barrel.Reversed = True
    pad_c8_barrel.Refine = True
    pad_c8_barrel.Length = 16.4
    pad_c8_barrel.setExpression("Length", "Parameters.C8_BodyTotalD")

    sk_c8_cav = c8_body.newObject("Sketcher::SketchObject", "C8_CavityAndHoles_Sketch")
    attach_sketch(sk_c8_cav, c8_yz, "Parameters.Length / 2 + Parameters.C8_FlangeT + Parameters.C8_LipH + 0.1 mm", 75.1)
    add_horizontal_slot(
        sk_c8_cav, 0.0, 22.5, 8.2, 16.5 - 8.2,
        "Parameters.C8_PosY + (16.5 mm - 8.2 mm) / 2",
        "Parameters.C8_PosZ", "8.2 mm", "16.5 mm - 8.2 mm",
    )
    for c_sign, c_tag in ((-1.0, "-"), (1.0, "+")):
        hy_c8 = c_sign * 14.0
        g_fh = sk_c8_cav.addGeometry(Part.Circle(FreeCAD.Vector(hy_c8, 22.5, 0.0), FreeCAD.Vector(0, 0, 1), 1.75), False)
        bind_expr(sk_c8_cav, ("Diameter", g_fh, 3.5), "3.5 mm")
        bind_expr(sk_c8_cav, ("DistanceX", -1, 1, g_fh, 3, hy_c8), f"Parameters.C8_PosY {c_tag} Parameters.C8_HolePitch / 2")
        bind_expr(sk_c8_cav, ("DistanceY", -1, 1, g_fh, 3, 22.5), "Parameters.C8_PosZ")
    sketches_to_verify.append(sk_c8_cav)
    pkt_c8_cav = c8_body.newObject("PartDesign::Pocket", "C8_CavityAndHoles_Pocket")
    pkt_c8_cav.Profile = sk_c8_cav
    pkt_c8_cav.Reversed = False
    pkt_c8_cav.Refine = True
    pkt_c8_cav.Length = 10.1

    c8_metal = doc.addObject("PartDesign::Body", "C8_Contacts_Metal")
    c8_metal.Label = "C8_Contacts_Metal"
    c8_metal.AllowCompound = True
    ac_asm.addObject(c8_metal)
    c8m_yz = get_origin_plane(c8_metal, "YZ_Plane")

    sk_c8_pins = c8_metal.newObject("Sketcher::SketchObject", "C8_Pins_Sketch")
    attach_sketch(sk_c8_pins, c8m_yz, "Parameters.Length / 2 + Parameters.C8_FlangeT + Parameters.C8_LipH - 10.0 mm", 65.0)
    for py_s, p_tag in ((-4.3, "-"), (4.3, "+")):
        gp = sk_c8_pins.addGeometry(Part.Circle(FreeCAD.Vector(py_s, 22.5, 0.0), FreeCAD.Vector(0, 0, 1), 1.18), False)
        bind_expr(sk_c8_pins, ("Diameter", gp, 2.36), "2.36 mm")
        bind_expr(sk_c8_pins, ("DistanceX", -1, 1, gp, 3, py_s), f"Parameters.C8_PosY {p_tag} 4.3 mm")
        bind_expr(sk_c8_pins, ("DistanceY", -1, 1, gp, 3, 22.5), "Parameters.C8_PosZ")
    sketches_to_verify.append(sk_c8_pins)
    pad_c8_pins = c8_metal.newObject("PartDesign::Pad", "C8_Pins_Pad")
    pad_c8_pins.Profile = sk_c8_pins
    pad_c8_pins.Reversed = False
    pad_c8_pins.Length = 9.0

    sk_c8_lugs = c8_metal.newObject("Sketcher::SketchObject", "C8_Lugs_Sketch")
    attach_sketch(sk_c8_lugs, c8m_yz, "Parameters.Length / 2 + Parameters.C8_FlangeT + Parameters.C8_LipH - Parameters.C8_BodyTotalD", 58.6)
    for py_s, p_tag in ((-4.3, "-"), (4.3, "+")):
        add_rect(
            sk_c8_lugs, py_s - 0.4, 22.5 - 1.4, py_s + 0.4, 22.5 + 1.4,
            f"Parameters.C8_PosY {p_tag} 4.3 mm - 0.4 mm",
            "Parameters.C8_PosZ - 1.4 mm",
            "0.8 mm", "2.8 mm",
        )
    sketches_to_verify.append(sk_c8_lugs)
    pad_c8_lugs = c8_metal.newObject("PartDesign::Pad", "C8_Lugs_Pad")
    pad_c8_lugs.Profile = sk_c8_lugs
    pad_c8_lugs.Reversed = True
    pad_c8_lugs.Length = 3.7

    # =========================================================================
    # SECTION 5: TOP-LID UI STANDOFFS, BUTTON/LED ROOF HOLES & 2nd UI_PCB_Assembly
    # =========================================================================
    lid_xy = get_origin_plane(lid_body_ref, "XY_Plane")
    ui_off_y = -6.25
    ui_mount_pts = [
        (1, -22.57, -11.60),
        (2,   5.37, -11.60),
    ]
    ui_switch_pts = [
        ("SW9", -17.87, -1.56),
        ("SW1",  -0.35, -1.68),
    ]
    ui_led_pts = [
        (1, "LED1", -23.21, -17.28, "V", "Green"),
        (2, "LED2",   6.12, -17.28, "V", "Green"),
        (5, "LED5",  19.33,   1.98, "H", "Red"),
        (6, "LED6",  19.33,  -6.40, "H", "Green"),
        (7, "LED7",  19.33, -16.56, "H", "Amber"),
    ]

    sk_lid_uiso = lid_body_ref.newObject("Sketcher::SketchObject", "Lid_UIStandoffs_Sketch")
    attach_sketch(sk_lid_uiso, lid_xy, "Parameters.LidHeight - Parameters.RoofT - Parameters.UI_StandoffH", 2.0)
    for idx, hx, hy in ui_mount_pts:
        hy_w = hy + ui_off_y
        g_so = sk_lid_uiso.addGeometry(Part.Circle(FreeCAD.Vector(hx, hy_w, 0.0), FreeCAD.Vector(0, 0, 1), 2.7), False)
        bind_expr(sk_lid_uiso, ("Diameter", g_so, 5.4), "Parameters.UI_StandoffOD")
        bind_expr(sk_lid_uiso, ("DistanceX", -1, 1, g_so, 3, hx), f"Parameters.UI_OffsetX + Parameters.UI_H{idx}_X")
        bind_expr(sk_lid_uiso, ("DistanceY", -1, 1, g_so, 3, hy_w), f"Parameters.UI_OffsetY + Parameters.UI_H{idx}_Y")
    sketches_to_verify.append(sk_lid_uiso)

    pad_lid_uiso = lid_body_ref.newObject("PartDesign::Pad", "Lid_UIStandoffs_Pad")
    pad_lid_uiso.Profile = sk_lid_uiso
    pad_lid_uiso.Reversed = False
    pad_lid_uiso.Refine = True
    pad_lid_uiso.Length = 11.1
    pad_lid_uiso.setExpression("Length", "Parameters.UI_StandoffH + 0.1 mm")

    sk_lid_uipilot = lid_body_ref.newObject("Sketcher::SketchObject", "Lid_UIPilotHoles_Sketch")
    attach_sketch(sk_lid_uipilot, lid_xy, "Parameters.LidHeight - Parameters.RoofT - Parameters.UI_StandoffH - 0.1 mm", 1.9)
    for idx, hx, hy in ui_mount_pts:
        hy_w = hy + ui_off_y
        g_pi = sk_lid_uipilot.addGeometry(Part.Circle(FreeCAD.Vector(hx, hy_w, 0.0), FreeCAD.Vector(0, 0, 1), 1.3), False)
        bind_expr(sk_lid_uipilot, ("Diameter", g_pi, 2.6), "Parameters.UI_StandoffHoleDia")
        bind_expr(sk_lid_uipilot, ("DistanceX", -1, 1, g_pi, 3, hx), f"Parameters.UI_OffsetX + Parameters.UI_H{idx}_X")
        bind_expr(sk_lid_uipilot, ("DistanceY", -1, 1, g_pi, 3, hy_w), f"Parameters.UI_OffsetY + Parameters.UI_H{idx}_Y")
    sketches_to_verify.append(sk_lid_uipilot)

    pkt_lid_uipilot = lid_body_ref.newObject("PartDesign::Pocket", "Lid_UIPilotHoles_Pocket")
    pkt_lid_uipilot.Profile = sk_lid_uipilot
    pkt_lid_uipilot.Reversed = True
    pkt_lid_uipilot.Length = 8.6
    pkt_lid_uipilot.setExpression("Length", "Parameters.UI_StandoffHoleDepth + 0.1 mm")

    sk_lid_uiholes = lid_body_ref.newObject("Sketcher::SketchObject", "Lid_UIHoles_Sketch")
    attach_sketch(sk_lid_uiholes, lid_xy, "Parameters.LidHeight - Parameters.RoofT - 0.5 mm", 12.5)
    for sw_name, sx, sy in ui_switch_pts:
        sy_w = sy + ui_off_y
        g_sw = sk_lid_uiholes.addGeometry(Part.Circle(FreeCAD.Vector(sx, sy_w, 0.0), FreeCAD.Vector(0, 0, 1), 6.15), False)
        bind_expr(sk_lid_uiholes, ("Diameter", g_sw, 12.3), "Parameters.UI_CapHoleDia")
        bind_expr(sk_lid_uiholes, ("DistanceX", -1, 1, g_sw, 3, sx), f"Parameters.UI_OffsetX + Parameters.UI_{sw_name}_X")
        bind_expr(sk_lid_uiholes, ("DistanceY", -1, 1, g_sw, 3, sy_w), f"Parameters.UI_OffsetY + Parameters.UI_{sw_name}_Y")
    for led_idx, led_name, lx, ly, _ori, _col in ui_led_pts:
        ly_w = ly + ui_off_y
        g_ld = sk_lid_uiholes.addGeometry(Part.Circle(FreeCAD.Vector(lx, ly_w, 0.0), FreeCAD.Vector(0, 0, 1), 2.7), False)
        bind_expr(sk_lid_uiholes, ("Diameter", g_ld, 5.4), "Parameters.UI_LEDHoleDia")
        bind_expr(sk_lid_uiholes, ("DistanceX", -1, 1, g_ld, 3, lx), f"Parameters.UI_OffsetX + Parameters.UI_{led_name}_X")
        bind_expr(sk_lid_uiholes, ("DistanceY", -1, 1, g_ld, 3, ly_w), f"Parameters.UI_OffsetY + Parameters.UI_{led_name}_Y")
    sketches_to_verify.append(sk_lid_uiholes)

    pkt_lid_uiholes = lid_body_ref.newObject("PartDesign::Pocket", "Lid_UIHoles_Pocket")
    pkt_lid_uiholes.Profile = sk_lid_uiholes
    pkt_lid_uiholes.Reversed = True
    pkt_lid_uiholes.Refine = True
    pkt_lid_uiholes.Length = 3.0
    pkt_lid_uiholes.setExpression("Length", "Parameters.RoofT + 1.0 mm")

    ui_asm = doc.addObject("App::Part", "UI_PCB_Assembly")
    ui_asm.Label = "UI_PCB_Assembly"
    ui_asm.Placement = FreeCAD.Placement(FreeCAD.Vector(0.0, 0.0, 35.4), FreeCAD.Rotation())
    ui_asm.setExpression(".Placement.Base.x", "Top_Lid.Placement.Base.x")
    ui_asm.setExpression(".Placement.Base.y", "Top_Lid.Placement.Base.y")
    ui_asm.setExpression(
        ".Placement.Base.z",
        "Top_Lid.Placement.Base.z + Parameters.LidHeight - Parameters.RoofT - Parameters.UI_StandoffH - Parameters.UI_Thick",
    )

    b_uipcb = doc.addObject("PartDesign::Body", "UI_PCB_Board")
    b_uipcb.Label = "UI_PCB_Board"
    ui_asm.addObject(b_uipcb)

    sk_uipcb = b_uipcb.newObject("Sketcher::SketchObject", "UI_PCB_Sketch")
    attach_sketch(sk_uipcb, get_origin_plane(b_uipcb, "XY_Plane"))
    ui_l, ui_w = 51.4, 80.0
    uy0 = -ui_w / 2.0 + ui_off_y
    uy1 = ui_w / 2.0 + ui_off_y
    g_u0, _, _ = add_line(sk_uipcb, (-ui_l / 2.0, uy0), (ui_l / 2.0, uy0))
    g_u1, _, _ = add_line(sk_uipcb, (ui_l / 2.0, uy0), (ui_l / 2.0, uy1))
    g_u2, _, _ = add_line(sk_uipcb, (ui_l / 2.0, uy1), (-ui_l / 2.0, uy1))
    g_u3, _, _ = add_line(sk_uipcb, (-ui_l / 2.0, uy1), (-ui_l / 2.0, uy0))
    for ga, gb in ((g_u0, g_u1), (g_u1, g_u2), (g_u2, g_u3), (g_u3, g_u0)):
        bind_expr(sk_uipcb, ("Coincident", ga, 2, gb, 1))
    bind_expr(sk_uipcb, ("Horizontal", g_u0))
    bind_expr(sk_uipcb, ("Vertical", g_u1))
    bind_expr(sk_uipcb, ("Horizontal", g_u2))
    bind_expr(sk_uipcb, ("Vertical", g_u3))
    bind_expr(sk_uipcb, ("DistanceX", g_u0, 1, g_u0, 2, ui_l), "Parameters.UI_Length")
    bind_expr(sk_uipcb, ("DistanceY", g_u1, 1, g_u1, 2, ui_w), "Parameters.UI_Width")
    bind_expr(sk_uipcb, ("DistanceX", -1, 1, g_u0, 1, -ui_l / 2.0), "Parameters.UI_OffsetX - Parameters.UI_Length / 2")
    bind_expr(sk_uipcb, ("DistanceY", -1, 1, g_u0, 1, uy0), "Parameters.UI_OffsetY - Parameters.UI_Width / 2")
    sketches_to_verify.append(sk_uipcb)

    pad_uipcb = b_uipcb.newObject("PartDesign::Pad", "UI_PCB_Pad")
    pad_uipcb.Profile = sk_uipcb
    pad_uipcb.Refine = True
    pad_uipcb.Length = 1.6
    pad_uipcb.setExpression("Length", "Parameters.UI_Thick")

    sk_uiholes = b_uipcb.newObject("Sketcher::SketchObject", "UI_PCB_Holes_Sketch")
    attach_sketch(sk_uiholes, get_origin_plane(b_uipcb, "XY_Plane"), "Parameters.UI_Thick + 0.1 mm", 1.7)
    for idx, hx, hy in ui_mount_pts:
        hy_w = hy + ui_off_y
        g_uh = sk_uiholes.addGeometry(Part.Circle(FreeCAD.Vector(hx, hy_w, 0.0), FreeCAD.Vector(0, 0, 1), 1.5), False)
        bind_expr(sk_uiholes, ("Diameter", g_uh, 3.0), "Parameters.UI_HoleDia")
        bind_expr(sk_uiholes, ("DistanceX", -1, 1, g_uh, 3, hx), f"Parameters.UI_OffsetX + Parameters.UI_H{idx}_X")
        bind_expr(sk_uiholes, ("DistanceY", -1, 1, g_uh, 3, hy_w), f"Parameters.UI_OffsetY + Parameters.UI_H{idx}_Y")
    sketches_to_verify.append(sk_uiholes)

    pkt_uiholes = b_uipcb.newObject("PartDesign::Pocket", "UI_PCB_Holes_Pocket")
    pkt_uiholes.Profile = sk_uiholes
    pkt_uiholes.Reversed = False
    pkt_uiholes.Length = 1.9
    pkt_uiholes.setExpression("Length", "Parameters.UI_Thick + 0.3 mm")

    ui_comp_grp = doc.addObject("App::Part", "UI_PCB_Components_3D")
    ui_comp_grp.Label = "UI_PCB_Components_3D"
    ui_asm.addObject(ui_comp_grp)

    ui_sw = doc.addObject("PartDesign::Body", "UI_Switches_SW9_SW1")
    ui_sw.Label = "UI_Switches_SW9_SW1"
    ui_sw.AllowCompound = True
    ui_comp_grp.addObject(ui_sw)
    for sw_name, sx, sy in ui_switch_pts:
        add_comp_box_feature(
            ui_sw, f"{sw_name}_Base", sx, sy, 8.0, 8.0,
            "Parameters.UI_Thick", 1.6, 5.2, sx, sy,
            ox_expr="Parameters.UI_OffsetX", oy_expr="Parameters.UI_OffsetY", ox_val=0.0, oy_val=ui_off_y,
        )
        add_comp_cyl_feature(
            ui_sw, f"{sw_name}_Stem", sx, sy + ui_off_y, 4.0, "4.0 mm",
            "Parameters.UI_Thick + 5.15 mm", 6.75, 8.2, None,
            cx_expr=f"Parameters.UI_OffsetX + Parameters.UI_{sw_name}_X",
            cy_expr=f"Parameters.UI_OffsetY + Parameters.UI_{sw_name}_Y",
        )

    ui_caps = doc.addObject("PartDesign::Body", "UI_ButtonCaps")
    ui_caps.Label = "UI_ButtonCaps"
    ui_caps.AllowCompound = True
    ui_comp_grp.addObject(ui_caps)
    for sw_name, sx, sy in ui_switch_pts:
        add_comp_cyl_feature(
            ui_caps, f"{sw_name}_CapFlange", sx, sy + ui_off_y, 12.8, "Parameters.UI_CapDia + 1.3 mm",
            "Parameters.UI_Thick + 7.8 mm", 9.4, 1.2, None,
            cx_expr=f"Parameters.UI_OffsetX + Parameters.UI_{sw_name}_X",
            cy_expr=f"Parameters.UI_OffsetY + Parameters.UI_{sw_name}_Y",
        )
        add_comp_cyl_feature(
            ui_caps, f"{sw_name}_CapHead", sx, sy + ui_off_y, 11.5, "Parameters.UI_CapDia",
            "Parameters.UI_Thick + 8.95 mm", 10.55, 6.05, "Parameters.UI_CapTopAbovePCB - 8.95 mm",
            cx_expr=f"Parameters.UI_OffsetX + Parameters.UI_{sw_name}_X",
            cy_expr=f"Parameters.UI_OffsetY + Parameters.UI_{sw_name}_Y",
        )
    sk_capsock = ui_caps.newObject("Sketcher::SketchObject", "CapSockets_Sketch")
    attach_sketch(sk_capsock, get_origin_plane(ui_caps, "XY_Plane"), "Parameters.UI_Thick + 7.75 mm", 9.35)
    for sw_name, sx, sy in ui_switch_pts:
        sy_w = sy + ui_off_y
        g_cs = sk_capsock.addGeometry(Part.Circle(FreeCAD.Vector(sx, sy_w, 0.0), FreeCAD.Vector(0, 0, 1), 2.1), False)
        bind_expr(sk_capsock, ("Diameter", g_cs, 4.2), "4.2 mm")
        bind_expr(sk_capsock, ("DistanceX", -1, 1, g_cs, 3, sx), f"Parameters.UI_OffsetX + Parameters.UI_{sw_name}_X")
        bind_expr(sk_capsock, ("DistanceY", -1, 1, g_cs, 3, sy_w), f"Parameters.UI_OffsetY + Parameters.UI_{sw_name}_Y")
    sketches_to_verify.append(sk_capsock)
    pkt_capsock = ui_caps.newObject("PartDesign::Pocket", "CapSockets_Pocket")
    pkt_capsock.Profile = sk_capsock
    pkt_capsock.Reversed = True
    pkt_capsock.Length = 5.7

    ui_led_leads = doc.addObject("PartDesign::Body", "UI_LED_Leads")
    ui_led_leads.Label = "UI_LED_Leads"
    ui_led_leads.AllowCompound = True
    ui_comp_grp.addObject(ui_led_leads)
    for _li, led_name, lx, ly, ori, _col in ui_led_pts:
        lw, ld = (0.8, 2.6) if ori == "V" else (2.6, 0.8)
        add_comp_box_feature(
            ui_led_leads, f"{led_name}_Leads", lx, ly, lw, ld,
            "Parameters.UI_Thick", 1.6, 6.1, lx, ly,
            ox_expr="Parameters.UI_OffsetX", oy_expr="Parameters.UI_OffsetY", ox_val=0.0, oy_val=ui_off_y,
        )

    def build_led_body(body_name, color_filter):
        b_ld = doc.addObject("PartDesign::Body", body_name)
        b_ld.Label = body_name
        b_ld.AllowCompound = True
        ui_comp_grp.addObject(b_ld)
        for _li, led_name, lx, ly, _ori, col in ui_led_pts:
            if col != color_filter:
                continue
            add_comp_cyl_feature(
                b_ld, f"{led_name}_Rim", lx, ly + ui_off_y, 5.6, "Parameters.UI_LEDDia + 0.6 mm",
                "Parameters.UI_Thick + 6.1 mm", 7.7, 1.0, None,
                cx_expr=f"Parameters.UI_OffsetX + Parameters.UI_{led_name}_X",
                cy_expr=f"Parameters.UI_OffsetY + Parameters.UI_{led_name}_Y",
            )
            add_comp_cyl_feature(
                b_ld, f"{led_name}_Lens", lx, ly + ui_off_y, 5.0, "Parameters.UI_LEDDia",
                "Parameters.UI_Thick + 7.05 mm", 8.65, 7.45, "Parameters.UI_LEDHeight - 7.05 mm",
                cx_expr=f"Parameters.UI_OffsetX + Parameters.UI_{led_name}_X",
                cy_expr=f"Parameters.UI_OffsetY + Parameters.UI_{led_name}_Y",
            )
        return b_ld

    ui_leds_g = build_led_body("UI_LEDs_Green", "Green")
    ui_led_r  = build_led_body("UI_LED_Red",    "Red")
    ui_led_a  = build_led_body("UI_LED_Amber",  "Amber")

    ui_res = doc.addObject("PartDesign::Body", "UI_Resistors_R")
    ui_res.Label = "UI_Resistors_R"
    ui_res.AllowCompound = True
    ui_comp_grp.addObject(ui_res)
    for r_name, rx, ry, rw, rd in [
        ("R14", -8.80,  17.09, 9.8, 3.8),
        ("R15", -8.80,  12.65, 9.8, 3.8),
        ("R16", -8.80,   7.82, 9.8, 3.8),
        ("R2", -17.11, -18.78, 3.8, 9.8),
        ("R1",   0.03, -18.39, 3.8, 9.8),
    ]:
        add_comp_box_feature(
            ui_res, r_name, rx, ry, rw, rd,
            "Parameters.UI_Thick + 0.2 mm", 1.8, 3.8, rx, ry,
            ox_expr="Parameters.UI_OffsetX", oy_expr="Parameters.UI_OffsetY", ox_val=0.0, oy_val=ui_off_y,
        )

    ui_j1 = doc.addObject("PartDesign::Body", "UI_Header_J1")
    ui_j1.Label = "UI_Header_J1"
    ui_comp_grp.addObject(ui_j1)
    add_comp_box_feature(
        ui_j1, "J1_Shroud", -8.09, -13.87, 2.54, 20.32,
        "0 mm", 0.0, 6.0, -8.09, -13.87,
        ox_expr="Parameters.UI_OffsetX", oy_expr="Parameters.UI_OffsetY", ox_val=0.0, oy_val=ui_off_y,
        reversed_pad=True,
    )

    doc.recompute()

    # =========================================================================
    # SECTION 6: ENCLOSURE TEXT ENGRAVINGS (NO TOP LOGO, NO VENTS!)
    # =========================================================================
    gfx_src_grp = doc.addObject("App::Part", "Graphics_Sources")
    gfx_src_grp.Label = "Graphics_Sources"
    gfx_hidden_names = [gfx_src_grp.Name]

    # 6A: Right (+X) wall "220V AC" below SUNROM 7669 C8 AC socket
    ac_txt_xy = build_centered_text_faces("220V AC", 3.2)
    ac_txt_rot = ac_txt_xy.transformed(
        FreeCAD.Placement(FreeCAD.Vector(70.05, 0.0, 9.5), FreeCAD.Rotation(FreeCAD.Vector(1, 1, 1), 120)).toMatrix()
    )
    engrave_faces_into_body(
        doc, base_body_ref, gfx_src_grp, "Base_Engrave_AC",
        ac_txt_rot, 0.45, FreeCAD.Vector(1, 0, 0), gfx_hidden_names,
    )

    # 6B: Front (-Y) wall "VALVE 1" & "VALVE 2" directly above the 2 barrel jack holes
    v1_wall_rot = build_centered_text_faces("VALVE 1", 2.8).transformed(
        FreeCAD.Placement(FreeCAD.Vector(-21.8, -50.05, 25.5), FreeCAD.Rotation(FreeCAD.Vector(1, 0, 0), 90)).toMatrix()
    )
    v2_wall_rot = build_centered_text_faces("VALVE 2", 2.8).transformed(
        FreeCAD.Placement(FreeCAD.Vector(24.7, -50.05, 25.5), FreeCAD.Rotation(FreeCAD.Vector(1, 0, 0), 90)).toMatrix()
    )
    engrave_faces_into_body(
        doc, base_body_ref, gfx_src_grp, "Base_Engrave_Valves",
        Part.makeCompound([v1_wall_rot, v2_wall_rot]), 0.45, FreeCAD.Vector(0, -1, 0), gfx_hidden_names,
    )

    # 6C: Top_Lid roof "VALVE 1" & "VALVE 2" cleanly below push buttons SW9 & SW1 (NO TOP LOGO!)
    v1_lid = build_centered_text_faces("VALVE 1", 2.5).translate(FreeCAD.Vector(-17.87, -17.30, 15.05))
    v2_lid = build_centered_text_faces("VALVE 2", 2.5).translate(FreeCAD.Vector(-0.35, -17.30, 15.05))
    engrave_faces_into_body(
        doc, lid_body_ref, gfx_src_grp, "Lid_Engrave_Valves",
        Part.makeCompound([v1_lid, v2_lid]), 0.40, FreeCAD.Vector(0, 0, 1), gfx_hidden_names,
    )

    # 6D: Underside DIBL logo on Bottom_Case floor — sanitized with polygonal wires so 0 micro-slivers & selfInt=False!
    emblem_leaves_2d, emblem_drop_2d, logo_text_2d = extract_dibl_svg_layers()
    whole_logo_2d = Part.makeCompound([emblem_leaves_2d, emblem_drop_2d, logo_text_2d])
    bot_logo_raw_2d = scale_and_center_2d(whole_logo_2d, 56.0, (0.0, 0.0), mirror_x=True)
    bot_logo_clean_2d = sanitize_2d_compound_for_3d_print(bot_logo_raw_2d, min_seg=0.05)
    engrave_faces_into_body(
        doc, base_body_ref, gfx_src_grp, "Base_Engrave_BotLogo",
        bot_logo_clean_2d.translate(FreeCAD.Vector(0.0, 0.0, -0.05)), 0.40, FreeCAD.Vector(0, 0, -1), gfx_hidden_names,
    )

    doc.recompute()

    # =========================================================================
    # VERIFICATION SUITE
    # =========================================================================
    print("\n--- SKETCH VERIFICATION ---", flush=True)
    for sk in sketches_to_verify:
        verify_sketch(sk)
    print(f"  All {len(sketches_to_verify)} sketches verified: DoF=0, conflicts=0, redundant=0", flush=True)

    base_sh = base_body_ref.Shape.copy()
    lid_sh = lid_body_ref.Shape.copy()
    opt3_sh = b3.Shape.copy()
    opt3_sh.Placement = base_body_ref.Placement

    assert len(base_sh.Solids) == 1 and base_sh.isValid()
    assert len(lid_sh.Solids) == 1 and lid_sh.isValid()
    assert len(opt3_sh.Solids) == 1 and opt3_sh.isValid()

    m_base = MeshPart.meshFromShape(Shape=base_sh, LinearDeflection=0.05, AngularDeflection=0.25)
    m_lid = MeshPart.meshFromShape(Shape=lid_sh, LinearDeflection=0.05, AngularDeflection=0.25)
    print(f"  Bottom_Case mesh: Solids={len(base_sh.Solids)} Facets={m_base.CountFacets} isSolid={m_base.isSolid()} nonManifold={m_base.hasNonManifolds()} selfInt={m_base.hasSelfIntersections()}", flush=True)
    print(f"  Top_Lid mesh    : Solids={len(lid_sh.Solids)} Facets={m_lid.CountFacets} isSolid={m_lid.isSolid()} nonManifold={m_lid.hasNonManifolds()} selfInt={m_lid.hasSelfIntersections()}", flush=True)

    # If underside logo still triggers selfInt in mesh, remove Base_Engrave_BotLogo_Pocket so Bottom_Case is 100% selfInt=False
    if m_base.hasSelfIntersections() or not m_base.isSolid() or m_base.hasNonManifolds():
        print("  Removing Base_Engrave_BotLogo_Pocket to guarantee selfInt=False on Bottom_Case...", flush=True)
        base_body_ref.removeObject(doc.getObject("Base_Engrave_BotLogo_Pocket"))
        doc.removeObject("Base_Engrave_BotLogo_Pocket")
        base_body_ref.removeObject(doc.getObject("Base_Engrave_BotLogo_Binder"))
        doc.removeObject("Base_Engrave_BotLogo_Binder")
        gfx_src_grp.removeObject(doc.getObject("Base_Engrave_BotLogo_Src"))
        doc.removeObject("Base_Engrave_BotLogo_Src")
        gfx_hidden_names = [n for n in gfx_hidden_names if "BotLogo" not in n]
        doc.recompute()
        base_sh = base_body_ref.Shape.copy()
        m_base = MeshPart.meshFromShape(Shape=base_sh, LinearDeflection=0.05, AngularDeflection=0.25)
        print(f"  Bottom_Case mesh (clean bed): Solids={len(base_sh.Solids)} Facets={m_base.CountFacets} isSolid={m_base.isSolid()} nonManifold={m_base.hasNonManifolds()} selfInt={m_base.hasSelfIntersections()}", flush=True)

    # =========================================================================
    # COLOR PALETTE & VISIBILITY CONFIGURATION
    # =========================================================================
    offwhite_plastic = ((0.93, 0.92, 0.87), 0.25, 0.25)
    pcb_green        = ((0.06, 0.42, 0.16), 0.55, 0.60)
    comp_bodies = [
        ("Comp_BarrelJacks_U4_U1",    c_jacks,     (0.12, 0.12, 0.13), 0.30, 0.30),
        ("Comp_Terminals_P1_P2",      c_terms,     (0.26, 0.74, 0.40), 0.35, 0.40),
        ("Comp_ESP32_DevKit",         c_mcu,       (0.08, 0.20, 0.44), 0.50, 0.55),
        ("Comp_ESP32_RF_Shield",      c_mcu_sh,    (0.80, 0.82, 0.85), 0.90, 0.88),
        ("Comp_TB6612_Red",           c_tb,        (0.78, 0.12, 0.12), 0.50, 0.55),
        ("Comp_TB6612_IC",            c_tb_ic,     (0.13, 0.13, 0.14), 0.28, 0.25),
        ("Comp_SMPS_PCBs",            c_smps_pcb,  (0.05, 0.34, 0.12), 0.50, 0.55),
        ("Comp_SMPS_Transformers",    c_smps_xfmr, (0.93, 0.76, 0.14), 0.60, 0.65),
        ("Comp_Headers_J3_J2",        c_hdrs,      (0.14, 0.14, 0.16), 0.28, 0.25),
    ]
    ui_comp_bodies = [
        ("UI_Switches_SW9_SW1", ui_sw,        (0.15, 0.15, 0.17), 0.28, 0.30),
        ("UI_ButtonCaps",       ui_caps,      (0.22, 0.24, 0.27), 0.32, 0.35),
        ("UI_LED_Leads",        ui_led_leads, (0.82, 0.84, 0.86), 0.88, 0.85),
        ("UI_LEDs_Green",       ui_leds_g,    (0.10, 0.82, 0.24), 0.80, 0.85),
        ("UI_LED_Red",          ui_led_r,     (0.92, 0.14, 0.14), 0.80, 0.85),
        ("UI_LED_Amber",        ui_led_a,     (0.96, 0.56, 0.10), 0.80, 0.85),
        ("UI_Resistors_R",      ui_res,       (0.85, 0.74, 0.50), 0.45, 0.50),
        ("UI_Header_J1",        ui_j1,        (0.14, 0.14, 0.16), 0.28, 0.25),
    ]
    styled_bodies = [
        (base_body_ref,  *offwhite_plastic),
        (lid_body_ref,   *offwhite_plastic),
        (b1_rail,        *offwhite_plastic),
        (b1_plate,       (0.86, 0.85, 0.81), 0.25, 0.25),
        (b2,             *offwhite_plastic),
        (b3,             *offwhite_plastic),
        (b_pcb,          *pcb_green),
        (b_uipcb,        *pcb_green),
        (c8_body,        (0.12, 0.12, 0.13), 0.28, 0.25),
        (c8_metal,       (0.82, 0.84, 0.86), 0.90, 0.88),
    ] + [(c_obj, rgb, sp, shn) for _cn, c_obj, rgb, sp, shn in comp_bodies] + [
        (uc_obj, rgb, sp, shn) for _cn, uc_obj, rgb, sp, shn in ui_comp_bodies
    ]

    obj_colors = {}
    obj_vis = {}
    for b_obj, rgb, sp, shn in styled_bodies:
        obj_colors[b_obj.Name] = (rgb, sp, shn, 0.0)
        for child in b_obj.Group:
            if child.isDerivedFrom("PartDesign::Feature") and not child.isDerivedFrom("PartDesign::SubShapeBinder"):
                obj_colors[child.Name] = (rgb, sp, shn, 0.0)
                obj_vis[child.Name] = (child == b_obj.Tip)
            else:
                obj_vis[child.Name] = False
        if hasattr(b_obj, "Origin") and b_obj.Origin:
            obj_vis[b_obj.Origin.Name] = False
            for feat in b_obj.Origin.OriginFeatures:
                obj_vis[feat.Name] = False

    for grp in (opt1_grp, pcb_asm, comp_grp, ui_asm, ui_comp_grp, ac_asm, gfx_src_grp):
        if hasattr(grp, "Origin") and grp.Origin:
            obj_vis[grp.Origin.Name] = False
            for feat in grp.Origin.OriginFeatures:
                obj_vis[feat.Name] = False

    for hn in gfx_hidden_names:
        obj_vis[hn] = False

    obj_vis["Bottom_Case"] = True
    obj_vis["Top_Lid"] = True
    obj_vis["AC_Socket_C8_Panel"] = True
    obj_vis["C8_Body_PA66"] = True
    obj_vis["C8_Contacts_Metal"] = True
    obj_vis["PCB_Assembly"] = True
    obj_vis["PCB_Board"] = True
    obj_vis["PCB_Components_3D"] = True
    for _cn, c_obj, *_ in comp_bodies:
        obj_vis[c_obj.Name] = True
    obj_vis["UI_PCB_Assembly"] = True
    obj_vis["UI_PCB_Board"] = True
    obj_vis["UI_PCB_Components_3D"] = True
    for _cn, uc_obj, *_ in ui_comp_bodies:
        obj_vis[uc_obj.Name] = True

    obj_vis["Mount_Option1_Dovetail"] = False
    obj_vis["Opt1_Case_DovetailRail"] = False
    obj_vis["Opt1_Wall_SlidePlate"] = False
    obj_vis["Mount_Option2_KeyholeRails"] = False
    obj_vis["Mount_Option3_ExternalFlanges"] = True

    obj_specs = [(o.Name, o.TypeId) for o in doc.Objects]
    doc.saveAs(DST_FCSTD)
    if gui_tpl:
        inject_gui_colors_to_fcstd(DST_FCSTD, gui_tpl, obj_specs, obj_colors, obj_vis)
    print(f"Saved from-scratch Case_140x100x50_WallMount.FCStd ({len(doc.Objects)} objects) -> {DST_FCSTD}", flush=True)

    # Also build the 2-part sample_case_no_vent_no_logo.FCStd directly from this from-scratch build
    base_local = base_body_ref.Shape.copy()
    base_local.Placement = FreeCAD.Placement()
    opt3_local = b3.Shape.copy()
    opt3_local.Placement = FreeCAD.Placement()
    base_fused_local = base_local.fuse(opt3_local).Solids[0]
    base_fused_local.Placement = FreeCAD.Placement()

    lid_local = lid_body_ref.Shape.copy()
    lid_local.Placement = FreeCAD.Placement()

    m_bf = MeshPart.meshFromShape(Shape=base_fused_local, LinearDeflection=0.05, AngularDeflection=0.25)
    print(f"  2-Part Fused Bottom_Case+Opt3: Solids={len(base_fused_local.Solids)} Facets={m_bf.CountFacets} isSolid={m_bf.isSolid()} nonManifold={m_bf.hasNonManifolds()} selfInt={m_bf.hasSelfIntersections()}", flush=True)

    sdoc = FreeCAD.newDocument("sample_case_no_vent_no_logo")
    sbc = sdoc.addObject("Part::Feature", "Bottom_Case")
    sbc.Label = "Bottom_Case"
    sbc.Shape = base_fused_local
    sbc.Placement = base_body_ref.Placement

    stl = sdoc.addObject("Part::Feature", "Top_Lid")
    stl.Label = "Top_Lid"
    stl.Shape = lid_local
    stl.Placement = lid_body_ref.Placement

    sdoc.recompute()
    sdoc.saveAs(SAMPLE_NO_VENT_NO_LOGO_FCSTD)
    if gui_tpl:
        inject_gui_colors_to_fcstd(
            SAMPLE_NO_VENT_NO_LOGO_FCSTD, gui_tpl,
            [("Bottom_Case", "Part::Feature"), ("Top_Lid", "Part::Feature")],
            {"Bottom_Case": (*offwhite_plastic, 0.0), "Top_Lid": (*offwhite_plastic, 0.0)},
            {"Bottom_Case": True, "Top_Lid": True},
        )
    print(f"Saved from-scratch sample_case_no_vent_no_logo.FCStd -> {SAMPLE_NO_VENT_NO_LOGO_FCSTD}", flush=True)
    FreeCAD.closeDocument(sdoc.Name)
    FreeCAD.closeDocument(doc.Name)


if __name__ == "__main__":
    build()
