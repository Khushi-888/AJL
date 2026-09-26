import flet as ft

def main(page: ft.Page):
    page.title = "StockSense Dashboard"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.padding = 30
    page.fonts = {"Inter": "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap"}
    page.theme = ft.Theme(font_family="Inter")

    # Reusable UI Components
    def kpi_card(title, value, color, icon):
        return ft.Card(
            elevation=4,
            content=ft.Container(
                width=200, padding=20, border_radius=10,
                content=ft.Column([
                    ft.Icon(icon, size=40, color=color),
                    ft.Text(title, size=16, weight=ft.FontWeight.BOLD, color=ft.colors.BLUE_GREY_600),
                    ft.Text(value, size=32, weight=ft.FontWeight.W_800, color=color)
                ], alignment=ft.MainAxisAlignment.CENTER, horizontal_alignment=ft.CrossAxisAlignment.CENTER)
            )
        )

    # Navigation Logic
    def nav_change(e):
        page.clean()
        index = e.control.selected_index
        
        if index == 0:
            page.add(ft.Text("Overview Dashboard", size=32, weight=ft.FontWeight.W_800))
            page.add(ft.Row([
                kpi_card("Total Products", "124", ft.colors.BLUE, ft.icons.INVENTORY_2),
                kpi_card("Low Stock Items", "3", ft.colors.RED, ft.icons.WARNING),
                kpi_card("Pending Receipts", "12", ft.colors.ORANGE, ft.icons.INPUT),
                kpi_card("Pending Deliveries", "8", ft.colors.GREEN, ft.icons.LOCAL_SHIPPING),
            ], wrap=True, spacing=20))
            
        elif index == 1:
            page.add(ft.Text("Products & Inventory", size=32, weight=ft.FontWeight.W_800))
            page.add(ft.DataTable(
                columns=[
                    ft.DataColumn(ft.Text("SKU")),
                    ft.DataColumn(ft.Text("Product Name")),
                    ft.DataColumn(ft.Text("Category"), numeric=True),
                    ft.DataColumn(ft.Text("Stock Quant")),
                ],
                rows=[
                    ft.DataRow(cells=[ft.DataCell(ft.Text("CH-01")), ft.DataCell(ft.Text("Office Chair")), ft.DataCell(ft.Text("Furniture")), ft.DataCell(ft.Text("150"))]),
                    ft.DataRow(cells=[ft.DataCell(ft.Text("D-99")), ft.DataCell(ft.Text("Steel Desk")), ft.DataCell(ft.Text("Furniture")), ft.DataCell(ft.Text("2", color=ft.colors.RED))]),
                ],
            ))
            
        elif index == 2:
            page.add(ft.Text("Operations Agent (AI)", size=32, weight=ft.FontWeight.W_800))
            chat_input = ft.TextField(hint_text="e.g. Receive 50 units of CH-01 to Main Warehouse...", expand=True, border_radius=10)
            
            def submit_to_agent(e):
                page.add(ft.Card(content=ft.Container(padding=10, content=ft.Text(f"Agent Executing: {chat_input.value}", color=ft.colors.GREEN_700))))
                chat_input.value = ""
                page.update()
                
            page.add(ft.Row([chat_input, ft.FloatingActionButton(icon=ft.icons.SEND, on_click=submit_to_agent, bgcolor=ft.colors.BLUE)]))

        page.add(nav)
        page.update()

    nav = ft.NavigationBar(
        selected_index=0,
        destinations=[
            ft.NavigationDestination(icon=ft.icons.DASHBOARD_OUTLINED, selected_icon=ft.icons.DASHBOARD, label="Dashboard"),
            ft.NavigationDestination(icon=ft.icons.INVENTORY_2_OUTLINED, selected_icon=ft.icons.INVENTORY_2, label="Products"),
            ft.NavigationDestination(icon=ft.icons.SMART_TOY_OUTLINED, selected_icon=ft.icons.SMART_TOY, label="AI Agent"),
        ],
        on_change=nav_change
    )
    
    page.add(nav)
    # Trigger initial load
    nav_change(type('Event', (object,), {'control': type('Control', (object,), {'selected_index': 0})()})())

if __name__ == "__main__":
    # Runs on the web
    ft.app(target=main, view=ft.AppView.WEB_BROWSER, port=8550)
