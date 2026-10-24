from lead_studio.app import _drafts


def test_birthday_search_fallback_uses_generic_copy_without_confidence():
    drafts = _drafts("dog", "pet_birthday", 35)

    assert "absolutely adorable" in drafts["public_copy"]
    assert "happy birthday" not in drafts["public_copy"].casefold()


def test_confirmed_birthday_keeps_birthday_copy():
    drafts = _drafts("dog", "pet_birthday", 88)

    assert "happy birthday" in drafts["public_copy"].casefold()


def test_confirmed_adoption_keeps_new_home_copy():
    drafts = _drafts("cat", "new_adoption", 88)

    assert "welcoming your new cat home" in drafts["public_copy"].casefold()
