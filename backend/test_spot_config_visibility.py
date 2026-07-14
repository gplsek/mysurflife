"""M2: spot visibility gate.

Regression coverage for the two anti-leak guarantees once private spots live in
`spots` (migration 021): the public catalog filter is applied, and only an admin
or the spot's owner may read/edit a private spot's windows.
"""
import routes.spot_config as sc
from database import only_public_spots


class _FakeQuery:
    """Records .eq() filters so we can assert the visibility predicate is applied."""
    def __init__(self):
        self.filters = []

    def eq(self, col, val):
        self.filters.append((col, val))
        return self


# ── public catalog filter (list/map/search) ───────────────────────────────────
def test_only_public_spots_filters_visibility():
    q = only_public_spots(_FakeQuery())
    assert ("visibility", "public") in q.filters


# ── edit gate (PUT windows) ───────────────────────────────────────────────────
def test_can_edit_admin(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: True)
    assert sc._can_edit({"user_id": "admin-1"}, owner_id="someone-else") is True


def test_can_edit_owner(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert sc._can_edit({"user_id": "u-1"}, owner_id="u-1") is True


def test_can_edit_rejects_non_owner_non_admin(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert sc._can_edit({"user_id": "u-2"}, owner_id="u-1") is False


def test_can_edit_rejects_unauthenticated(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert sc._can_edit(None, owner_id="u-1") is False


def test_can_edit_rejects_non_admin_on_catalog_spot(monkeypatch):
    # owner_id is None for a public catalog spot — only admins may edit it.
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert sc._can_edit({"user_id": "u-1"}, owner_id=None) is False


# ── read gate (GET windows) — private spot is 404 for a non-owner ─────────────
def _get_is_hidden(user, owner_id, visibility, is_admin):
    """Mirror of the GET gate decision in get_spot_windows."""
    return visibility != "public" and not sc._can_edit(user, owner_id)


def test_private_spot_hidden_from_stranger(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert _get_is_hidden({"user_id": "stranger"}, "owner-1", "private", False) is True


def test_private_spot_visible_to_owner(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert _get_is_hidden({"user_id": "owner-1"}, "owner-1", "private", False) is False


def test_public_spot_visible_to_anyone(monkeypatch):
    monkeypatch.setattr(sc, "is_admin", lambda uid: False)
    assert _get_is_hidden(None, None, "public", False) is False
