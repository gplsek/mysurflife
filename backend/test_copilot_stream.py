"""Tests for the streaming respond-message extractor (copilot SSE)."""
from copilot import _extract_respond_message as ext


def test_extracts_growing_message():
    assert ext('{"message": "How') == "How"
    assert ext('{"message": "Howdy surfer') == "Howdy surfer"


def test_no_message_yet():
    assert ext('{"mess') == ""
    assert ext('') == ""


def test_stops_at_closing_quote():
    assert ext('{"message": "done", "artifacts": [{"big": "stuff"}]') == "done"


def test_unescapes_and_handles_truncated_escapes():
    assert ext('{"message": "line1\\nline2') == "line1\nline2"
    # trailing lone backslash: wait for the next delta
    assert ext('{"message": "abc\\') == "abc"
    # truncated \\uXXXX: wait for completion
    assert ext('{"message": "abc\\u26') == "abc"
    assert ext('{"message": "abc\\u2603"') == "abc☃"


def test_quote_inside_message():
    assert ext('{"message": "he said \\"go\\" and') == 'he said "go" and'
