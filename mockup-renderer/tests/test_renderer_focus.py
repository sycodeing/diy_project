from unittest.mock import patch

from PIL import Image

from renderer import fit_cover, prepare_artwork


def test_focal_cover_keeps_requested_horizontal_subject_in_frame():
    artwork = Image.new("RGB", (400, 200), "red")
    artwork.paste("blue", (200, 0, 400, 200))

    result = fit_cover(artwork, (100, 100), focus=(0.85, 0.5))

    assert result.getpixel((50, 50)) == (0, 0, 255)


def test_pet_head_mode_uses_detected_focus_without_changing_default_mode():
    artwork = Image.new("RGB", (400, 200), "red")
    artwork.paste("blue", (200, 0, 400, 200))

    with patch("renderer.detect_pet_head_focus", return_value=(0.85, 0.5)):
        focused = prepare_artwork(artwork, None, (100, 100), "pet_head")
    default = prepare_artwork(artwork, None, (100, 100))

    assert focused.getpixel((50, 50)) == (0, 0, 255, 255)
    assert default.getpixel((50, 50)) != focused.getpixel((50, 50))
