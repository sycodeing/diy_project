from lead_studio.app import _drafts


def test_birthday_search_fallback_uses_generic_copy_without_confidence():
    drafts = _drafts("dog", "pet_birthday", 35)

    assert "absolutely adorable" in drafts["public_copy"]
    assert "happy birthday" not in drafts["public_copy"].casefold()


def test_confirmed_birthday_uses_generic_cute_pet_copy():
    drafts = _drafts("dog", "pet_birthday", 88)

    assert "absolutely adorable" in drafts["public_copy"].casefold()
    assert "birthday" not in drafts["public_copy"].casefold()


def test_confirmed_adoption_uses_generic_cute_pet_copy():
    drafts = _drafts("cat", "new_adoption", 88)

    assert "absolutely adorable" in drafts["public_copy"].casefold()
    assert "adopt" not in drafts["public_copy"].casefold()
    assert "new cat home" not in drafts["public_copy"].casefold()
